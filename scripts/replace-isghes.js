#!/usr/bin/env node

import {promises as fs} from 'node:fs';
import path from 'node:path';

function getEndOfLine(source) {
    return source.includes('\r\n') ? '\r\n' : '\n';
}

function findMatchingBrace(source, openBraceIndex) {
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = openBraceIndex; i < source.length; i += 1) {
        const char = source[i];
        const nextChar = source[i + 1];

        if (inLineComment) {
            if (char === '\n') {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (char === '*' && nextChar === '/') {
                inBlockComment = false;
                i += 1;
            }
            continue;
        }

        if (inSingleQuote) {
            if (char === '\\') {
                i += 1;
                continue;
            }
            if (char === "'") {
                inSingleQuote = false;
            }
            continue;
        }

        if (inDoubleQuote) {
            if (char === '\\') {
                i += 1;
                continue;
            }
            if (char === '"') {
                inDoubleQuote = false;
            }
            continue;
        }

        if (inTemplate) {
            if (char === '\\') {
                i += 1;
                continue;
            }
            if (char === '`') {
                inTemplate = false;
            }
            continue;
        }

        if (char === '/' && nextChar === '/') {
            inLineComment = true;
            i += 1;
            continue;
        }

        if (char === '/' && nextChar === '*') {
            inBlockComment = true;
            i += 1;
            continue;
        }

        if (char === "'") {
            inSingleQuote = true;
            continue;
        }

        if (char === '"') {
            inDoubleQuote = true;
            continue;
        }

        if (char === '`') {
            inTemplate = true;
            continue;
        }

        if (char === '{') {
            depth += 1;
            continue;
        }

        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return i;
            }
        }
    }

    return -1;
}

function buildReplacement(source, startIndex) {
    const eol = getEndOfLine(source);
    const lineStart = source.lastIndexOf('\n', startIndex - 1) + 1;
    const indent = source.slice(lineStart, startIndex).match(/^[\t ]*/)?.[0] ?? '';
    const bodyIndent = `${indent}    `;

    return `function isGhes() {${eol}${bodyIndent}return false;${eol}${indent}}`;
}

function replaceIsGhesFunctions(source) {
    const signature = /function\s+isGhes\s*\(\s*\)\s*\{/g;
    const ranges = [];
    let match;

    while ((match = signature.exec(source)) !== null) {
        const start = match.index;
        const openBraceIndex = start + match[0].lastIndexOf('{');
        const closeBraceIndex = findMatchingBrace(source, openBraceIndex);

        if (closeBraceIndex < 0) {
            throw new Error(`Failed to find closing brace for isGhes() at index ${start}`);
        }

        ranges.push({start, endExclusive: closeBraceIndex + 1});
        signature.lastIndex = closeBraceIndex + 1;
    }

    if (ranges.length === 0) {
        return {updatedSource: source, replacements: 0};
    }

    let updatedSource = source;
    for (let i = ranges.length - 1; i >= 0; i -= 1) {
        const {start, endExclusive} = ranges[i];
        const replacement = buildReplacement(source, start);
        updatedSource =
            updatedSource.slice(0, start) +
            replacement +
            updatedSource.slice(endExclusive);
    }

    return {updatedSource, replacements: ranges.length};
}

async function* walkJsFiles(dir) {
    const entries = await fs.readdir(dir, {withFileTypes: true});
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walkJsFiles(fullPath);
            continue;
        }
        if (entry.isFile() && fullPath.endsWith('.js')) {
            yield fullPath;
        }
    }
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const targetArg = args.find(arg => !arg.startsWith('--'));
    const targetDir = path.resolve(targetArg ?? 'dist');

    const stats = await fs.stat(targetDir).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        throw new Error(`Target directory does not exist: ${targetDir}`);
    }

    let filesScanned = 0;
    let filesUpdated = 0;
    let totalReplacements = 0;

    for await (const filePath of walkJsFiles(targetDir)) {
        filesScanned += 1;
        const source = await fs.readFile(filePath, 'utf8');
        const {updatedSource, replacements} = replaceIsGhesFunctions(source);

        if (replacements === 0) {
            continue;
        }

        totalReplacements += replacements;

        if (updatedSource !== source) {
            filesUpdated += 1;
            if (!dryRun) {
                await fs.writeFile(filePath, updatedSource, 'utf8');
            }
        }
    }

    if (dryRun) {
        console.log(
            `Dry run complete: scanned ${filesScanned} file(s), would update ${filesUpdated} file(s), replacing ${totalReplacements} isGhes() function(s).`
        );
        return;
    }

    console.log(
        `Done: scanned ${filesScanned} file(s), updated ${filesUpdated} file(s), replaced ${totalReplacements} isGhes() function(s).`
    );
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
