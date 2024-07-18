import sys
import asyncio
import aiohttp
import re
from tqdm.asyncio import tqdm
import os
import json

# Lets make print always flush
import builtins
def print(*args, **kwargs):
    builtins.print(*args, **kwargs, flush=True)

# Regex to extract the address
regex = r"0x[a-fA-F0-9]{40}"
CONCURRENT_REQUESTS = 10  # Adjust the number of concurrent requests as needed


class SEVERITY:
    LOW = 1
    MEDIUM = 5
    HIGH = 10
    SEVERE = 15

# Extract the address from the string
async def extract_eth_address(address):
    matches = re.findall(regex, address)
    if len(matches) == 0:
        print(f"No address found in the string {address}")
        return None
    return matches[0]


async def check_address(session, address, semaphore):
    headers = {"Authorization": os.environ["TRM_API_KEY"], "Content-Type": "application/json"}

    url = os.path.join(os.environ["TRM_BASE_URL"], "screening", "addresses")
    payload_json = [{"address": address, "chain": "ethereum"}]

    async with semaphore:  # Use the semaphore to limit concurrent requests
        async with session.post(url, json=payload_json, headers=headers) as response:
            try:
                screening_json = await response.json(content_type=None)
                screening_json = screening_json[0]

                if len(screening_json["addressRiskIndicators"]) == 0:
                    screening_json["block"] = False
                    
                else:
                    if any(
                        indicator["categoryRiskScoreLevel"] >= SEVERITY.SEVERE
                        for indicator in screening_json["addressRiskIndicators"]
                    ):
                        screening_json["block"] = True
                    else:
                        screening_json["block"] = False
                        # Lets print the json nicely
                return screening_json
            except Exception as e:
                print(f"Error: {e}",flush=True)
                print(f"Response: {response}",flush=True)
                print(f"Response text: {await response.text()}",flush=True)
                print(f"Error with Address {address}",flush=True)
                return None



# Main coroutine that processes the file and checks addresses
async def main(filename):
    # Read the file and extract addresses
    with open(filename) as f:
        lines = f.readlines()

    # Remove whitespace characters like `\n` at the end of each line
    addresses = [line.strip() for line in lines]

    semaphore = asyncio.Semaphore(CONCURRENT_REQUESTS)

    # Use aiohttp ClientSession for making requests
    async with aiohttp.ClientSession() as session:
        tasks = []
        for address in addresses:
            eth_address = await extract_eth_address(address)
            if eth_address:
                task = check_address(session, eth_address, semaphore)
                tasks.append(task)

        # Initialize progress bar and counts
        blocked_count = 0
        not_blocked_count = 0
        outblock = ""
        # Process tasks with progress bar
        for task in tqdm(asyncio.as_completed(tasks), total=len(tasks), desc="Checking Addresses"):
            result = await task
            if(result == None):
                print(f"Address {result['address']} failed")
                continue
            if result["block"] == False:
                not_blocked_count += 1
                print(f"Address {result['address']} NOT blocked by TRM on screening API endpoint")
                outblock += f"{result['address']}\n"
                #exit()
            elif result["block"] == True:
                #print(result)
                blocked_count += 1
            else:
                print(f"Unknown response for address {result['address']}: {result}")

        # Print results
        print(f"Total NOT blocked on TRM: {not_blocked_count}")
        print(f"Total blocked on TRM: {blocked_count}")
        print(outblock)

# Get the filename of eth addresses to scan from command line arguments
filename = sys.argv[1]

# if we get a second param its the number of threads
if len(sys.argv) > 2:
    CONCURRENT_REQUESTS = int(sys.argv[2])
# Run the asynchronous main function
asyncio.run(main(filename))
