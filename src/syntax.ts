export type Segment = { text: string; cls: string }

type Hljs = Awaited<typeof import('highlight.js/lib/common')>['default']

// Auto-detection walks every grammar, so cap what we hand it. Past this, plain
// monospace is a fair trade for a diff that appears straight away.
const MAX_DETECT = 120_000
const MIN_RELEVANCE = 5

let hljs: Hljs | null = null

/** highlight.js is a separate chunk, fetched on the first comparison. */
export async function load() {
    hljs ??= (await import('highlight.js/lib/common')).default
}

/** The language both texts look like, or null when it's prose or a weak guess. */
export function detect(a: string, b: string): string | null {
    if (!hljs || a.length + b.length > MAX_DETECT) return null
    const result = hljs.highlightAuto(`${a}\n${b}`)
    return result.language && result.relevance >= MIN_RELEVANCE ? result.language : null
}


/**
 * Highlights the whole text in one pass, so multi-line strings and comments are
 * read in context, then cuts the result into one list of segments per line.
 */
export function segment(lines: string[], language: string): (Segment[] | null)[] {
    if (!hljs) return lines.map(() => null)
    const html = hljs.highlight(lines.join('\n'), { language, ignoreIllegals: true }).value
    const parsed = parse(html)

    // A line's segments have to rebuild it character for character, or the word
    // ranges would land in the wrong place: fall back to plain text if not.
    return lines.map((line, i) => {
        const segs = parsed[i]
        if (!segs) return null
        const length = segs.reduce((n, s) => n + s.text.length, 0)
        return length === line.length ? segs : null
    })
}

function parse(html: string): Segment[][] {
    const root = new DOMParser().parseFromString(`<pre>${html}</pre>`, 'text/html').querySelector('pre')
    const lines: Segment[][] = [[]]
    if (!root) return lines

    const walk = (node: Node, cls: string) => {
        for (const child of node.childNodes) {
            if (child instanceof Element) {
                walk(child, child.className || cls)
            } else {
                // A token can span lines (block comments, template literals)
                const pieces = (child.nodeValue ?? '').split('\n')
                pieces.forEach((text, i) => {
                    if (i > 0) lines.push([])
                    if (text) lines[lines.length - 1].push({ text, cls })
                })
            }
        }
    }

    walk(root, '')
    return lines
}
