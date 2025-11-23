// fetch3dns.mjs
import {
  Interface,
  getBytes,
  JsonRpcProvider,
  keccak256,
  toUtf8Bytes
} from "ethers";

// ─────────────────────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────────────────────

const BLOCKSCOUT_URL = "https://optimism.blockscout.com/api";
const OPTIMISM_RPC =
  process.env.OPTIMISM_RPC || "https://mainnet.optimism.io";

// 3DNS resolver (lowercase)
const RESOLVER = "0xf97aac6c8dbaebcb54ff166d79706e3af7a813c8";

// Events we know about (used for finding txs & fallback mode)
const ABI = [
  "event DNSRecordChanged(bytes32 indexed node, bytes name, uint16 resource, bytes data)",
  "event DNSRecordDeleted(bytes32 indexed node, bytes name, uint16 resource)"
];

const iface = new Interface(ABI);

const resourceNames = {
  1: "A",
  2: "NS",
  5: "CNAME",
  6: "SOA",
  15: "MX",
  16: "TXT",
  28: "AAAA",
  257: "CAA"
};

// ─────────────────────────────────────────────────────────────
//  ENS-style namehash for zone (node)
// ─────────────────────────────────────────────────────────────

function namehash(name) {
  let node = "0x" + "00".repeat(32);
  if (!name || name === ".") return node;

  const labels = name.toLowerCase().split(".");
  for (let i = labels.length - 1; i >= 0; i--) {
    const label = labels[i];
    const labelHash = keccak256(toUtf8Bytes(label));

    const buf = new Uint8Array(64);
    buf.set(getBytes(node), 0);
    buf.set(getBytes(labelHash), 32);
    node = keccak256(buf);
  }
  return node;
}

// ─────────────────────────────────────────────────────────────
//  DNS wire-format helpers
// ─────────────────────────────────────────────────────────────

function readNameFrom(buf, offset) {
  const labels = [];
  while (true) {
    const len = buf[offset++];
    if (!len) break;
    if (offset + len > buf.length) break;
    labels.push(
      Buffer.from(buf.slice(offset, offset + len)).toString("utf8")
    );
    offset += len;
  }
  return { name: labels.join("."), offset };
}

function decodeDnsName(raw) {
  if (!raw) return "";
  const bytes = typeof raw === "string" ? getBytes(raw) : Uint8Array.from(raw);
  return readNameFrom(bytes, 0).name;
}

function parseRRs(hex) {
  const buf = getBytes(hex);
  let off = 0;
  const rrs = [];

  while (off < buf.length) {
    const { name, offset: off2 } = readNameFrom(buf, off);
    off = off2;
    if (off + 10 > buf.length) break;

    const view = new DataView(buf.buffer, buf.byteOffset + off, 10);
    const type = view.getUint16(0);
    const klass = view.getUint16(2);
    const ttl = view.getUint32(4);
    const rdlen = view.getUint16(8);
    off += 10;

    const rdata = buf.slice(off, off + rdlen);
    off += rdlen;

    rrs.push({ name, type, klass, ttl, rdlen, rdata });
  }
  return rrs;
}

function prettyRdata(rr) {
  const { type, rdata } = rr;

  // TXT
  if (type === 16 && rdata.length > 0) {
    const len = rdata[0];
    return Buffer.from(rdata.slice(1, 1 + len)).toString("utf8");
  }

  // CNAME / NS
  if ((type === 5 || type === 2) && rdata.length > 0) {
    return decodeDnsName(rdata) + ".";
  }

  // A
  if (type === 1 && rdata.length === 4) {
    return Array.from(rdata).join(".");
  }

  // Fallback: hex or empty
  if (!rdata || rdata.length === 0) return "";
  return "0x" + Buffer.from(rdata).toString("hex");
}

// ─────────────────────────────────────────────────────────────
//  Blockscout + RPC helpers
// ─────────────────────────────────────────────────────────────

async function fetchLogs(topic0, label, node) {
  const params = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    fromBlock: "0",
    toBlock: "latest",
    address: RESOLVER,
    topic0,
    topic1: node,
    topic0_1_opr: "and"
  });

  const url = `${BLOCKSCOUT_URL}?${params.toString()}`;
  const res = await fetch(url);
  const json = await res.json();

  if (
    json &&
    json.status === "0" &&
    (json.message === "No logs found" || json.message === "No records found")
  ) {
    console.log(`No ${label} logs found for node ${node}.`);
    return [];
  }

  if (!json || json.status === "0") {
    console.error("Blockscout error:", json);
    throw new Error("Blockscout getLogs failed");
  }

  // Normalize null data/topics so ethers doesn't choke
  return json.result.map((log) => ({
    ...log,
    data: log.data === null ? "0x" : log.data,
    topics: (log.topics || []).map((t) => (t === null ? "0x" : t))
  }));
}

// Extract the DNS blob from calldata assuming fn(bytes32 node, bytes dnsData)
function extractDnsBlobFromCalldata(calldata, expectedNode) {
  const data = calldata.startsWith("0x") ? calldata.slice(2) : calldata;
  if (data.length < 8 + 64 * 2) return null;

  const body = data.slice(8); // skip selector

  const word0 = "0x" + body.slice(0, 64); // node
  const word1 = "0x" + body.slice(64, 128); // offset to bytes

  if (word0.toLowerCase() !== expectedNode.toLowerCase()) {
    return null;
  }

  const offsetBytes = parseInt(word1, 16);
  const dynOffset = offsetBytes * 2;

  if (dynOffset + 64 > body.length) return null;

  const lenHex = body.slice(dynOffset, dynOffset + 64);
  const length = parseInt(lenHex, 16);

  const bytesStart = dynOffset + 64;
  const bytesEnd = bytesStart + length * 2;
  if (bytesEnd > body.length) return null;

  const dnsHex = body.slice(bytesStart, bytesEnd);
  return "0x" + dnsHex;
}

// ─────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────

async function main() {
  // Parse args: domain + optional --csv
  const rawArgs = process.argv.slice(2);
  const csvFlagIndex = rawArgs.indexOf("--csv");
  const csv = csvFlagIndex !== -1;
  if (csv) rawArgs.splice(csvFlagIndex, 1);

  const domainArg = rawArgs[0];
  if (!domainArg) {
    console.error("Usage: node fetch3dns.mjs <domain> [--csv]");
    console.error("Example: node fetch3dns.mjs andrewmohawk.finance --csv");
    process.exit(1);
  }

  const domain = domainArg.toLowerCase().replace(/\.$/, "");
  const NODE = namehash(domain);

  console.log("Domain:           ", domain);
  console.log("Computed node:    ", NODE);
  console.log("Using Blockscout: ", BLOCKSCOUT_URL);
  console.log("Resolver:          ", RESOLVER);
  console.log("RPC:               ", OPTIMISM_RPC);
  console.log("CSV mode:          ", csv ? "ON" : "OFF", "\n");

  const provider = new JsonRpcProvider(OPTIMISM_RPC);

  const changedTopic = iface.getEvent("DNSRecordChanged").topicHash;
  const deletedTopic = iface.getEvent("DNSRecordDeleted").topicHash;

  console.log("Fetching DNSRecordChanged logs…");
  const changed = await fetchLogs(changedTopic, "DNSRecordChanged", NODE);

  console.log("Fetching DNSRecordDeleted logs…");
  const deleted = await fetchLogs(deletedTopic, "DNSRecordDeleted", NODE);

  const allLogs = [...changed, ...deleted];

  if (allLogs.length === 0) {
    console.log(`\nNo logs found for ${domain}.`);
    return;
  }

  // Group logs by txHash for fallback mode
  const logsByTx = new Map();
  for (const log of allLogs) {
    const txHash = log.transactionHash;
    if (!logsByTx.has(txHash)) logsByTx.set(txHash, []);
    logsByTx.get(txHash).push(log);
  }

  // Build a unique sorted list of tx hashes
  const txEntries = Array.from(logsByTx.entries())
    .map(([hash, logs]) => {
      const first = logs.reduce((min, l) =>
        Number(l.logIndex) < Number(min.logIndex) ? l : min
      );
      return {
        hash,
        blockNumber: Number(first.blockNumber),
        logIndex: Number(first.logIndex)
      };
    })
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      return a.logIndex - b.logIndex;
    });

  console.log(
    `\nFound ${txEntries.length} txs touching ${domain}. Decoding history…\n`
  );

  if (csv) {
    console.log(
      "timestamp_utc,block,tx,action,record_name,resource_code,value,etherscan_url"
    );
  }

  const tsCache = new Map();
  const state = new Map(); // key -> { exists: boolean, value: string }

  const pad = (s, n) => String(s).padEnd(n);

  for (const { hash: txHash, blockNumber } of txEntries) {
    const tx = await provider.getTransaction(txHash);
    if (!tx) continue;

    let ts = tsCache.get(blockNumber);
    if (!ts) {
      const block = await provider.getBlock(blockNumber);
      ts = new Date(Number(block.timestamp) * 1000).toISOString();
      tsCache.set(blockNumber, ts);
    }

    const etherscanUrl = `https://optimistic.etherscan.io/tx/${txHash}`;
    const txLogs = logsByTx.get(txHash) || [];

    const changesThisTx = [];

    // First, try calldata DNS blob path
    let usedBlob = false;
    if (tx.data && tx.to && tx.to.toLowerCase() === RESOLVER.toLowerCase()) {
      const dnsBlob = extractDnsBlobFromCalldata(tx.data, NODE);
      if (dnsBlob) {
        usedBlob = true;
        const rrs = parseRRs(dnsBlob);

        // Group by (name, type) from blob
        const groups = new Map();
        for (const rr of rrs) {
          const key = `${rr.name}|${rr.type}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(rr);
        }

        for (const [key, rrList] of groups.entries()) {
          const [name] = key.split("|");
          const type = rrList[0].type;
          const typeName = resourceNames[type] || `TYPE${type}`;

          const hasIN = rrList.some((rr) => rr.klass === 1);
          const has255 = rrList.some(
            (rr) => rr.klass === 255 && rr.ttl === 0
          );

          const rrForValue =
            rrList.find((rr) => rr.klass === 1) || rrList[0];
          const value = hasIN ? prettyRdata(rrForValue) : "";

          const prior = state.get(key);
          const priorExists = prior?.exists || false;
          const priorValue = prior?.value;

          const newExists = hasIN;
          const newValue = value;

          let action = null;

          if (!priorExists && newExists) {
            action = "ADD";
          } else if (priorExists && newExists) {
            if (newValue !== priorValue) {
              action = "UPDATE";
            } else {
              action = null; // no-op
            }
          } else if (priorExists && !newExists && has255) {
            action = "DELETE";
          } else {
            action = null;
          }

          // update state
          if (newExists) {
            state.set(key, { exists: true, value: newValue });
          } else if (action === "DELETE") {
            state.set(key, { exists: false, value: priorValue });
          }

          if (!action) continue;

          changesThisTx.push({
            action,
            name,
            type,
            typeName,
            value: newValue
          });
        }
      }
    }

    // Fallback: if no blob-based changes, use log-based deletes/changes
    if (!usedBlob) {
      for (const log of txLogs) {
        const parsed = iface.parseLog({
          topics: log.topics,
          data: log.data
        });

        const name = decodeDnsName(parsed.args.name);
        const resource = Number(parsed.args.resource);
        const typeName = resourceNames[resource] || `TYPE${resource}`;
        const key = `${name}|${resource}`;
        const prior = state.get(key);
        const priorExists = prior?.exists || false;

        let action = null;
        let value = "";

        if (parsed.name === "DNSRecordDeleted") {
          if (priorExists) {
            action = "DELETE";
            state.set(key, { exists: false, value: prior?.value });
          } else {
            // we didn't know it existed, but chain says delete; treat as DELETE
            action = "DELETE";
          }
        } else if (parsed.name === "DNSRecordChanged") {
          // we don't have rrdata here; treat as UPDATE/ADD without value
          if (priorExists) {
            action = "UPDATE";
          } else {
            action = "ADD";
          }
          state.set(key, { exists: true, value: "" });
        }

        if (!action) continue;

        changesThisTx.push({
          action,
          name,
          type: resource,
          typeName,
          value
        });
      }
    }

    if (changesThisTx.length === 0) {
      continue;
    }

    if (csv) {
      for (const c of changesThisTx) {
        console.log(
          `${ts},${blockNumber},${txHash},${c.action},${c.name},${c.type} (${c.typeName}),${c.value},${etherscanUrl}`
        );
      }
    } else {
      console.log(
        `--- ${ts} | block ${blockNumber} | ${txHash.slice(
          0,
          10
        )}… ---\n${etherscanUrl}\n`
      );
      for (const c of changesThisTx) {
        const actionStr = pad(`[${c.action}]`, 10);
        const typeStr = pad(`${c.type} (${c.typeName})`, 14);
        console.log(
          `  ${actionStr} ${typeStr} ${c.name}  ->  ${c.value}`
        );
      }
      console.log("");
    }
  }

  if (!csv) {
    console.log("Done.\n");
  }
}

function pad(s, n) {
  return String(s).padEnd(n);
}

main().catch((err) => {
  console.error("Fatal error:", err);
});
