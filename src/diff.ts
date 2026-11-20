import { diffArrays, diffWordsWithSpace } from 'diff'

/** A half-open [start, end) span of character offsets within one line. */
export type Range = [number, number]

export type Row =
    | { kind: 'equal'; a: number; b: number }
    | { kind: 'del'; a: number }
    | { kind: 'add'; b: number }
    | { kind: 'mod'; a: number; b: number; aWords: Range[]; bWords: Range[] }

export type Result = {
    rows: Row[]
    added: number
    removed: number
    changed: number
}

// Below this share of characters in common, two paired lines are treated as
// unrelated: marking every other word is noisier than marking the whole line.
const SIMILAR = 0.3

// Myers' algorithm is quadratic in the number of differences, so give up rather
// than lock the tab on two large, unrelated texts.
const TIMEOUT = 3000

export const splitLines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n')

/**
 * When both texts are JSON objects or arrays, lays each out one value per line
 * so a small edit is a small diff, not one changed line thousands of characters
 * long. Returns null otherwise.
 */
export function formatJsonPair(a: string, b: string): [string, string] | null {
    const isContainer = (text: string) => {
        if (!/^\s*[[{]/.test(text)) return false
        try {
            JSON.parse(text)
            return true
        } catch {
            return false
        }
    }
    return isContainer(a) && isContainer(b) ? [formatJson(a), formatJson(b)] : null
}

// Re-indents the text as written instead of round-tripping it through
// JSON.stringify, which would round long numbers, rewrite 1.0 as 1 and drop
// duplicate keys: changes a diff must never hide. Assumes valid JSON.
function formatJson(text: string): string {
    let out = ''
    let depth = 0
    const newline = () => '\n' + '  '.repeat(depth)

    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (c === '"') {
            let j = i + 1
            while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1
            out += text.slice(i, j + 1)
            i = j
        } else if (c === '{' || c === '[') {
            let j = i + 1
            while (/\s/.test(text[j])) j++
            if (text[j] === (c === '{' ? '}' : ']')) {
                out += c + text[j]
                i = j
            } else {
                depth++
                out += c + newline()
            }
        } else if (c === '}' || c === ']') {
            depth--
            out += newline() + c
        } else if (c === ',') {
            out += ',' + newline()
        } else if (c === ':') {
            out += ': '
        } else if (!/\s/.test(c)) {
            out += c
        }
    }
    return out
}

/**
 * Line diff, then a word diff inside each pair of changed lines. Returns null
 * if the line diff ran out of time.
 */
export function compare(a: string[], b: string[], ignoreWhitespace: boolean): Result | null {
    const key = ignoreWhitespace ? (line: string) => line.replace(/\s+/g, ' ').trim() : (line: string) => line

    const parts = diffArrays(a.map(key), b.map(key), { timeout: TIMEOUT })
    if (!parts) return null

    const rows: Row[] = []
    let added = 0
    let removed = 0
    let changed = 0
    let ai = 0
    let bi = 0
    let dels: number[] = []
    let adds: number[] = []

    // Pair the removed and added lines of a change block so the two columns stay
    // level, and keep the leftovers as one-sided rows.
    const flush = () => {
        const paired = Math.min(dels.length, adds.length)
        for (let i = 0; i < paired; i++) {
            const words = wordRanges(a[dels[i]], b[adds[i]])
            rows.push({ kind: 'mod', a: dels[i], b: adds[i], aWords: words?.a ?? [], bWords: words?.b ?? [] })
            changed++
        }
        for (const line of dels.slice(paired)) {
            rows.push({ kind: 'del', a: line })
            removed++
        }
        for (const line of adds.slice(paired)) {
            rows.push({ kind: 'add', b: line })
            added++
        }
        dels = []
        adds = []
    }

    for (const part of parts) {
        if (part.removed) {
            for (let i = 0; i < part.count; i++) dels.push(ai++)
        } else if (part.added) {
            for (let i = 0; i < part.count; i++) adds.push(bi++)
        } else {
            flush()
            for (let i = 0; i < part.count; i++) rows.push({ kind: 'equal', a: ai++, b: bi++ })
        }
    }
    flush()

    return { rows, added, removed, changed }
}

function wordRanges(a: string, b: string): { a: Range[]; b: Range[] } | null {
    const parts = diffWordsWithSpace(a, b)
    const aRanges: Range[] = []
    const bRanges: Range[] = []
    let ai = 0
    let bi = 0
    let common = 0

    for (const part of parts) {
        const len = part.value.length
        if (part.added) {
            bRanges.push([bi, bi + len])
            bi += len
        } else if (part.removed) {
            aRanges.push([ai, ai + len])
            ai += len
        } else {
            common += len
            ai += len
            bi += len
        }
    }

    if (common / Math.max(a.length, b.length, 1) < SIMILAR) return null
    return { a: aRanges, b: bRanges }
}
