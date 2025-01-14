import fs from 'fs';
import { webcrack } from 'webcrack'; 
import { JSDOM } from 'jsdom';
import fetch from 'node-fetch';
import { parse } from '@babel/parser';
import _traverse from "@babel/traverse";
const traverse = _traverse.default;
import dns from 'dns';
import { URL } from 'url';
import { promisify } from 'util';

const lookup = promisify(dns.lookup);


async function canResolveDomain(urlString) {
  try {
    const url = new URL(urlString); // Create a URL object to parse the URL
    await lookup(url.hostname); // Check if the hostname can be resolved
    return true; // Domain resolved
  } catch (error) {
    return false; // Domain could not be resolved
  }
}

async function fetchAndListScriptSrc(url) {
// lets first make sure we can resolve the domain
const validDomain = await canResolveDomain(url)
if( validDomain == false) {
    console.log("Domain not found:", url)
    return []
}

let script_list = []
console.log('Fetching URL:', url)
  try {
    const response = await fetch(url); // Fetch the URL content
    const body = await response.text(); // Get the response body as text
    const dom = new JSDOM(body); // Parse the DOM
    const scripts = [...dom.window.document.querySelectorAll('script')]; // Select all script tags
    
    // List script src attributes
    scripts.forEach(script => {
      if (script.src) {
        // if the script is local to the domain, then we should log it, ie if the source is not a CDN or has http/s
        if (!script.src.includes("http") && !script.src.includes("https")) {
            // Lets build a list of script filenames to exclude
            let exclude_list = ["jquery", "bootstrap", "popper", "fontawesome", "googleapis", "gstatic", "cloudflare", "cloudfront", "cloudflare", "maxcdn", "maxcdn.bootstrapcdn", "maxcdn.bootstrapcdn.com", "maxcdn.bootstrapcdn.com", "modules.js"]
            // Lets check if the script filename is in the exclude list
            if(!exclude_list.some(el => script.src.includes(el))) {
                let full_script_src = url + script.src
                script_list.push(full_script_src)
            }
        }
      }
    });

  } 
  // Lets catch getaddrinfo ENOTFOUND errors

  catch (error) {
    console.error('Error fetching URL:', error);
    //console.error("Domain not found:", url)
  }
  return script_list
}

function reportUrl(urls,domain) {
  //console.log('Bad URL:', url);
  console.log("Bad URLs for domain:", domain)
  urls.forEach(url => {
    console.log("- ",url)
  });
}

function extractDomainFromMainClass(jsClassStr) {
  // Regular expression to match `this.domain` assignment in the Main class constructor
  const domainRegex = /?this\.domain = "(.*?)";/;

  // Search for the domain using the regular expression
  const match = domainRegex.exec(jsClassStr);
  if (match && match[1]) {
    // If a match is found, return the domain
    return match[1];
  } else {
    // If no match is found, return a message indicating failure
    return [];
  }
}

function extractDomain(jsCode) {
  // Parse the code into an AST
  const ast = parse(jsCode, {
    sourceType: 'module',
    plugins: ['classProperties'], // Enable class properties plugin
  });

  let domainValue = [];

  // Traverse the AST to find the assignment to `this.domain`
  traverse(ast, {
    enter(path) {
      // Look for a class named 'Main' with a body containing a 'constructor'
      if (
        path.node.type === 'ClassDeclaration' &&
        path.node.id.name === 'Main'
      ) {
        path.traverse({
          // Inside Main, look for the constructor method
          ClassMethod({ node }) {
            if (node.kind === 'constructor') {
              // Traverse the constructor's body to find `this.domain` assignment
              node.body.body.forEach((expression) => {
                if (
                  expression.type === 'ExpressionStatement' &&
                  expression.expression.type === 'AssignmentExpression' &&
                  expression.expression.left.type === 'MemberExpression' &&
                  expression.expression.left.property.name === 'domain' &&
                  expression.expression.left.object.type === 'ThisExpression'
                ) {
                  // When found, extract the domain value if it's a string literal
                  const { right } = expression.expression;
                  if (right.type === 'StringLiteral') {
                    // lets add it to our list
                    domainValue.push(right.value);
                    
                  }
                }
              });
            }
          },
        });
      }
    },
  });

  return domainValue;
}

async function downloadAndDeobfuscate(scripts,domain){
  if(scripts.length == 0) {
    return
  }
  // scripts is a list of absolute URLs to javascript files, we should download them and deobfuscate them
  // Lets download each script and deobfuscate it
  scripts.forEach(async function(script) {
    // Lets download the script
    const response = await fetch(script); // Fetch the URL content
    const body = await response.text(); // Get the response body as text
    // Lets deobfuscate the script
    const result = await webcrack(body); // Await the promise from webcrack function
    // Save the deobfuscated code to a specific directory
    await result.save(outputDir);

    // After saving, you may want to scan the result.code for URLs and report them
    // This would be a regex or function to extract URLs from the deobfuscated code
    const urls = extractDomain(result.code); 
    if(urls.length == 0) {
      //print("No JS URLs found ")
      return
    }
    //urls.forEach(reportUrl); 
    // lets call foreach with urls and the domain
    reportUrl(urls,domain)

  });
}

// Read a file passed as a command line argument or default to 'bundle.js'
const fileName = process.argv[2];
const outputDir = process.argv[3] || 'output-dir'; // Optional second argument for output directory

let scripts = []
// Lets determine if the filename is a URL or a local file
if (fileName.includes("http") || fileName.includes("https")) {
    // If the filename is a URL, then lets fetch the DOM and extract the javascript files
    const scripts = await fetchAndListScriptSrc(fileName);
    downloadAndDeobfuscate(scripts,scripts)
    console.log(scripts)
}
else {
    // If the filename is a local file, then lets read the file and extract the javascript files
    const input_url = fs.readFileSync(fileName, 'utf8');
    // Lets go through each line in the file which are URLs and then fetch the DOM and extract the javascript files
    input_url.split(/\r?\n/).forEach(async function(line) {
        // If the line is not empty, then lets fetch the DOM and extract the javascript files
        if (line != "") {
            // Lets fetch the DOM and extract the javascript files
            try {

              const scripts = await fetchAndListScriptSrc(line);
              downloadAndDeobfuscate(scripts,line)
            }
            catch (error) {
              console.error('Error fetching URL:',line);
            }
            
        }
    });

}
