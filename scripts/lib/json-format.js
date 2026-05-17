'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Write a JSON value to disk with 2-space indent and a trailing newline.
 * Preserves the insertion order of the object (caller-controlled).
 * Returns the absolute path written.
 */
function writeJsonFile(filePath, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
  return filePath;
}

/**
 * Read + parse a JSON file. Caller must control the value shape.
 */
function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

module.exports = { writeJsonFile, readJsonFile };
