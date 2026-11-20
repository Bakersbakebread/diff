import type { Range, Row } from './diff'
import type { Segment } from './syntax'

export type View = 'split' | 'unified'
export type Side = { lines: string[]; segs: (Segment[] | null)[] }

// Lines kept either side of a collapsed run, and the smallest run worth hiding.
const CONTEXT = 3
const FOLD_MIN = 4

/**
 * One grid for the whole diff, rather than a grid per row: columns then line up
 * across every row by themselves, the two code columns come out the same width,
 * and a long line scrolls the pane sideways instead of wrapping and knocking the
 * two sides out of step.
 */
export function render(target: HTMLElement, rows: Row[], a: Side, b: Side, view: View) {
    target.dataset.view = view
    const grid = div('diff-grid')
    if (view === 'split') grid.append(...columnHeads())

    let i = 0
    while (i < rows.length) {
        if (rows[i].kind !== 'equal') {
            grid.append(...cellsFor(rows[i], a, b, view))
            i++
            continue
        }

        let end = i
        while (end < rows.length && rows[end].kind === 'equal') end++
        const run = rows.slice(i, end)
        const head = i === 0 ? 0 : CONTEXT
        const tail = end === rows.length ? 0 : CONTEXT
        const hidden = run.slice(head, run.length - tail)

        if (hidden.length >= FOLD_MIN) {
            for (const row of run.slice(0, head)) grid.append(...cellsFor(row, a, b, view))
            grid.append(fold(hidden, a, b, view))
            for (const row of run.slice(run.length - tail)) grid.append(...cellsFor(row, a, b, view))
        } else {
            for (const row of run) grid.append(...cellsFor(row, a, b, view))
        }
        i = end
    }

    target.replaceChildren(grid)
}

function columnHeads() {
    const heads = [div('diff-num diff-head'), head('Original'), div('diff-num diff-head'), head('Changed')]
    return heads
}

function head(text: string) {
    const el = div('diff-code diff-head font-sans font-semibold')
    el.textContent = text
    return el
}

function cellsFor(row: Row, a: Side, b: Side, view: View): HTMLElement[] {
    if (view === 'unified') {
        // A changed line reads as its removal followed by its addition
        if (row.kind === 'mod') {
            return [
                ...mark([num(row.a + 1, 'is-del'), num(null, 'is-del'), code(a, row.a, row.aWords, '-', 'is-del')]),
                ...mark([num(null, 'is-add'), num(row.b + 1, 'is-add'), code(b, row.b, row.bWords, '+', 'is-add')]),
            ]
        }
        if (row.kind === 'del') {
            return mark([num(row.a + 1, 'is-del'), num(null, 'is-del'), code(a, row.a, [], '-', 'is-del')])
        }
        if (row.kind === 'add') {
            return mark([num(null, 'is-add'), num(row.b + 1, 'is-add'), code(b, row.b, [], '+', 'is-add')])
        }
        return [num(row.a + 1), num(row.b + 1), code(a, row.a, [], ' ', '')]
    }

    if (row.kind === 'equal') {
        return [num(row.a + 1), code(a, row.a, [], ' ', ''), num(row.b + 1), code(b, row.b, [], ' ', '')]
    }
    if (row.kind === 'del') {
        return mark([num(row.a + 1, 'is-del'), code(a, row.a, [], '-', 'is-del'), num(null, 'is-gap'), div('diff-code is-gap')])
    }
    if (row.kind === 'add') {
        return mark([num(null, 'is-gap'), div('diff-code is-gap'), num(row.b + 1, 'is-add'), code(b, row.b, [], '+', 'is-add')])
    }
    return mark([
        num(row.a + 1, 'is-del'),
        code(a, row.a, row.aWords, '-', 'is-del'),
        num(row.b + 1, 'is-add'),
        code(b, row.b, row.bWords, '+', 'is-add'),
    ])
}

/** The first cell of a changed row is what the prev/next buttons move between. */
function mark(cells: HTMLElement[]) {
    cells[0].dataset.change = ''
    cells[0].tabIndex = -1
    return cells
}

function fold(hidden: Row[], a: Side, b: Side, view: View) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'diff-fold'
    btn.textContent = `${hidden.length} identical ${hidden.length === 1 ? 'line' : 'lines'} hidden. Show them`
    btn.addEventListener('click', () => {
        const frag = document.createDocumentFragment()
        for (const row of hidden) frag.append(...cellsFor(row, a, b, view))
        btn.replaceWith(frag)
    })
    return btn
}

function num(value: number | null, tint = '') {
    const el = div(`diff-num ${tint}`)
    el.setAttribute('aria-hidden', 'true')
    if (value !== null) el.textContent = String(value)
    return el
}

function code(side: Side, index: number, words: Range[], sign: string, tint: string) {
    const el = div(`diff-code ${tint}`)
    const line = side.lines[index] ?? ''

    const marker = document.createElement('span')
    marker.className = `diff-sign ${sign === '+' ? 'text-add' : sign === '-' ? 'text-del' : ''}`
    marker.textContent = sign
    if (sign === ' ') marker.setAttribute('aria-hidden', 'true')
    el.append(marker)

    for (const piece of pieces(line, side.segs[index] ?? null, words)) {
        if (!piece.changed && !piece.cls) {
            el.append(piece.text)
            continue
        }
        const span = document.createElement('span')
        span.className = [piece.cls, piece.changed ? (sign === '+' ? 'word-add' : 'word-del') : '']
            .filter(Boolean)
            .join(' ')
        span.textContent = piece.text
        el.append(span)
    }
    return el
}

/**
 * Cuts the line at both syntax boundaries and word-change boundaries at once,
 * so a changed word keeps its syntax colour and a token can be part changed.
 */
function pieces(line: string, segs: Segment[] | null, words: Range[]) {
    const changed = new Uint8Array(line.length)
    for (const [start, end] of words) changed.fill(1, start, Math.min(end, line.length))

    const out: { text: string; cls: string; changed: boolean }[] = []
    let offset = 0

    for (const seg of segs ?? [{ text: line, cls: '' }]) {
        let start = 0
        for (let i = 1; i <= seg.text.length; i++) {
            if (i === seg.text.length || changed[offset + i] !== changed[offset + start]) {
                out.push({ text: seg.text.slice(start, i), cls: seg.cls, changed: !!changed[offset + start] })
                start = i
            }
        }
        offset += seg.text.length
    }
    return out
}

function div(className: string) {
    const el = document.createElement('div')
    el.className = className
    return el
}
