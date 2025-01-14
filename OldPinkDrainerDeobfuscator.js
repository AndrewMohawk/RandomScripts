function decodeArrayParam(inputReference) {
    const inputString =inputReference;
    const outputArray = [];
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~"';
    let accumulatedValue = 0; // Holds the combined value of processed characters
    let bitsToProcess = 0; // Number of bits to shift and process
    let firstCharacterPosition = -1; // Position of the first character in the alphabet
    // make sure its valid input 
    if(typeof inputString !== "string") 
    {
        console.log("inputString is not a string it is a " + typeof inputString);
        return "";
    }

    if(typeof inputString !== "string" && inputString.length <= 0)
    {
        return ""; // No input, no output
    }

    for (let i = 0; i < inputString.length; i++) {
        const currentCharacter = inputString[i];
        const characterPosition = alphabet.indexOf(currentCharacter);

        if (characterPosition !== -1) {
            if (firstCharacterPosition < 0) {
                firstCharacterPosition = characterPosition;
            } else {
                // Update the position value based on the current character
                firstCharacterPosition += characterPosition * 91;
                // Combine the accumulated value with the shifted position value
                accumulatedValue = accumulatedValue | (firstCharacterPosition << bitsToProcess);
                // Determine how many bits we will process
                bitsToProcess += (8191 & firstCharacterPosition) > 88 ? 13 : 14;

                // Process the accumulated value in 8-bit chunks
                while (bitsToProcess > 7) {
                    // Take the rightmost 8 bits of the accumulated value and add to output
                    outputArray.push(accumulatedValue & 255);
                    // Shift the accumulated value right by 8 bits to process the next chunk
                    accumulatedValue = accumulatedValue >> 8;
                    // Decrease the bit counter as we've processed 8 bits
                    bitsToProcess -= 8;
                }
                firstCharacterPosition = -1;
            }
        }
    }

    // Handle any remaining bits after processing all characters
    if (firstCharacterPosition > -1) {
        outputArray.push((accumulatedValue | (firstCharacterPosition << bitsToProcess)) & 255);
    }

    outputString = ""
    for (let i = 0; i < outputArray.length; i++) {
        outputString += String.fromCharCode(outputArray[i]);
    }
    return outputString;
}    

function decodePinkDrainerArrays(largeArray) 
{
    let output = "";
    console.log("largeArray.length: " + largeArray.length);
    for (let i = 0; i < largeArray.length; i++) {
        output += decodeArrayParam(largeArray[i]) + " ";
    }
    return output;
}


function decompress(encodedString) {
    return (function(encodedString) {
        let index = 0;
        function readNext16Bit() {
            return encodedString[index++] << 8 | encodedString[index++];
        }

        let alphabetSize = readNext16Bit(),
            cumulativeFreq = 1,
            cumulativeFreqTable = [0, 1];
        for (let i = 1; i < alphabetSize; i++) {
            cumulativeFreqTable.push(cumulativeFreq += readNext16Bit());
        }

        let compressedDataLength = readNext16Bit(),
            compressedDataIndex = index;
        index += compressedDataLength;

        let bitBuffer = 0, bitCount = 0;
        function readBit() {
            if (bitCount == 0) {
                bitBuffer = bitBuffer << 8 | encodedString[index++];
                bitCount = 8;
            }
            return bitBuffer >> --bitCount & 1;
        }

        const MAX_INT32 = Math.pow(2, 31),
              UPPER_HALF = MAX_INT32 >>> 1,
              QUARTER = UPPER_HALF >> 1,
              INT32_MASK = MAX_INT32 - 1;

        let codeValue = 0;
        for (let i = 0; i < 31; i++) {
            codeValue = codeValue << 1 | readBit();
        }

        let decompressed = [], lowerBound = 0, range = MAX_INT32;
        while (true) {
            let symbolRange = Math.floor(((codeValue - lowerBound + 1) * cumulativeFreq - 1) / range),
                symbolLow = 0,
                symbolHigh = alphabetSize;
            while (symbolHigh - symbolLow > 1) {
                let mid = symbolLow + symbolHigh >>> 1;
                (symbolRange < cumulativeFreqTable[mid]) ? symbolHigh = mid : symbolLow = mid;
            }
            if (symbolLow == 0) break;

            decompressed.push(symbolLow);
            let newLower = lowerBound + Math.floor(range * cumulativeFreqTable[symbolLow] / cumulativeFreq),
                newUpper = lowerBound + Math.floor(range * cumulativeFreqTable[symbolLow + 1] / cumulativeFreq) - 1;
            while ((newLower ^ newUpper) & UPPER_HALF == 0) {
                codeValue = (codeValue << 1) & INT32_MASK | readBit();
                newLower = (newLower << 1) & INT32_MASK;
                newUpper = ((newUpper ^ UPPER_HALF) << 1) | UPPER_HALF | 1;
            }
            while (newLower & ~newUpper & QUARTER) {
                codeValue = (codeValue & UPPER_HALF | (codeValue << 1) & INT32_MASK >>> 1) | readBit();
                newLower = (newLower << 1) ^ UPPER_HALF;
                newUpper = ((newUpper ^ UPPER_HALF) << 1) | UPPER_HALF | 1;
            }
            lowerBound = newLower;
            range = 1 + newUpper - newLower;
        }

        let adjustmentBase = alphabetSize - 4;
        return decompressed.map((symbol) => {
            switch (symbol - adjustmentBase) {
                case 3:
                    return adjustmentBase + 65792 + (encodedString[compressedDataIndex++] << 16 | encodedString[compressedDataIndex++] << 8 | encodedString[compressedDataIndex++]);
                case 2:
                    return adjustmentBase + 256 + (encodedString[compressedDataIndex++] << 8 | encodedString[compressedDataIndex++]);
                case 1:
                    return adjustmentBase + encodedString[compressedDataIndex++];
                default:
                    return symbol - 1;
            }
        });
    })(encodedString);
}

function base64ToArray(base64Str) {
    base64Str = atob(base64Str);
    const charCodes = [];
    for (let i = 0; i < base64Str.length; i++) {
        charCodes.push(base64Str.charCodeAt(i));
    }
    return charCodes;
}
