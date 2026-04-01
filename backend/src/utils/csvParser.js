const readline = require('readline');

/**
 * Parse CSV file stream and yield rows as objects
 * Expected headers: studentId, name, email
 * 
 * @param {Stream} fileStream - File stream object
 * @returns {Promise<Array>} Array of parsed rows with metadata
 */
async function parseCSV(fileStream) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let headers = null;
    const rows = [];
    let lineNumber = 0;

    rl.on('line', (line) => {
      lineNumber++;

      // Skip empty lines
      if (!line.trim()) {
        return;
      }

      // Parse CSV line (simple approach - handles basic CSV without quoted fields containing commas)
      const fields = parseCSVLine(line);

      if (!headers) {
        // First line should be headers
        headers = fields.map((h) => h.toLowerCase().trim());

        // Validate required headers
        const requiredHeaders = ['studentid', 'name', 'email'];
        const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));

        if (missingHeaders.length > 0) {
          rl.close();
          return reject(
            new Error(`Missing required CSV headers: ${missingHeaders.join(', ')}. Expected: ${requiredHeaders.join(', ')}`)
          );
        }
      } else {
        // Data row
        const row = {};
        headers.forEach((header, index) => {
          row[header] = fields[index] ? fields[index].trim() : '';
        });
        rows.push({
          rowNumber: lineNumber,
          data: row,
        });
      }
    });

    rl.on('close', () => {
      if (!headers) {
        return reject(new Error('CSV file is empty or has no headers'));
      }
      resolve(rows);
    });

    rl.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Simple CSV line parser
 * Handles quoted fields and escaped quotes
 * 
 * @param {string} line - CSV line to parse
 * @returns {Array<string>} Array of field values
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  // Add last field
  result.push(current);

  return result;
}

module.exports = {
  parseCSV,
  parseCSVLine,
};
