import './style.css'
import { compare, formatJsonPair, splitLines, type Row } from './diff'
import { detect, load, segment } from './syntax'
import { render, type Side, type View } from './render'

const MAX_FILE = 2_000_000

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const ui = {
    status: $('status'),
    a: $<HTMLTextAreaElement>('a-input'),
    b: $<HTMLTextAreaElement>('b-input'),
    aFile: $<HTMLInputElement>('a-file'),
    bFile: $<HTMLInputElement>('b-file'),
    compareBtn: $<HTMLButtonElement>('compare-btn'),
    swapBtn: $<HTMLButtonElement>('swap-btn'),
    clearBtn: $<HTMLButtonElement>('clear-btn'),
    wsBtn: $<HTMLButtonElement>('ws-btn'),
    editor: $('editor'),
    editBtn: $<HTMLButtonElement>('edit-btn'),
    result: $('result'),
    stats: $('stats'),
    diff: $('diff'),
    note: $('result-note'),
    prevBtn: $<HTMLButtonElement>('prev-btn'),
    nextBtn: $<HTMLButtonElement>('next-btn'),
    splitBtn: $<HTMLButtonElement>('split-btn'),
    unifiedBtn: $<HTMLButtonElement>('unified-btn'),
}

// Two code columns need the room; below that the unified view is the only one
// that stays readable, so it takes over whatever the toggle says.
const wide = matchMedia('(min-width: 768px)')
const still = matchMedia('(prefers-reduced-motion: reduce)')

let preferred: View = 'split'
let ignoreWhitespace = false
let last: { rows: Row[]; a: Side; b: Side } | null = null
let changeIndex = -1

const view = (): View => (wide.matches ? preferred : 'unified')

// ---------- Compare

async function run() {
    const json = formatJsonPair(ui.a.value, ui.b.value)
    const aLines = splitLines(json?.[0] ?? ui.a.value)
    const bLines = splitLines(json?.[1] ?? ui.b.value)

    if (!ui.a.value && !ui.b.value) {
        ui.result.hidden = true
        ui.status.textContent = 'Paste two texts to compare'
        return
    }

    ui.status.textContent = 'Comparing'
    await load() // yields, so the status paints before the diff runs

    const result = compare(aLines, bLines, ignoreWhitespace)
    reveal()

    if (!result) {
        last = null
        ui.diff.hidden = true
        ui.stats.textContent = ''
        ui.note.textContent = 'These two texts are too long and too different to compare in the browser. Try smaller pieces.'
        setCounts()
        return
    }

    const language = detect(aLines.join('\n'), bLines.join('\n'))
    const a: Side = { lines: aLines, segs: language ? segment(aLines, language) : [] }
    const b: Side = { lines: bLines, segs: language ? segment(bLines, language) : [] }
    last = { rows: result.rows, a, b }
    changeIndex = -1

    const counts = [
        [result.added, 'added'],
        [result.removed, 'removed'],
        [result.changed, 'changed'],
    ] as const
    const present = counts.filter(([n]) => n > 0)
    // Deliberately no language name: auto-detection guesses the grammar well
    // enough to colour by, but not well enough to put a name on screen.
    const summary = present.map(([n, word], i) => (i === 0 ? `${n} ${n === 1 ? 'line' : 'lines'} ${word}` : `${n} ${word}`))
    ui.stats.textContent = summary.join(' · ')

    const changes = result.added + result.removed + result.changed
    ui.diff.hidden = changes === 0
    ui.prevBtn.disabled = changes === 0
    ui.nextBtn.disabled = changes === 0

    if (changes === 0) {
        ui.diff.replaceChildren()
        ui.stats.textContent = 'No differences'
        ui.note.textContent = ignoreWhitespace
            ? 'The two texts match once whitespace is ignored.'
            : 'The two texts are identical, character for character.'
    } else {
        render(ui.diff, result.rows, a, b, view())
        ui.note.textContent = 'Runs of identical lines are hidden; select one to expand it. Long lines wrap rather than scroll.'
        if (json) ui.note.textContent += ' Both texts are JSON, so they were laid out one value per line first: line numbers count those lines.'
    }

    setCounts()
}

// The result replaces the inputs rather than sitting under them: once compared,
// the diff is the only thing worth the screen. Edit brings the inputs back.
function reveal() {
    const first = ui.result.hidden
    ui.editor.hidden = true
    ui.result.hidden = false
    if (first) ui.result.classList.add('animate-rise')
    scrollTo(0, 0)
    ui.editBtn.focus({ preventScroll: true })
}

function edit() {
    last = null
    ui.result.hidden = true
    ui.diff.replaceChildren()
    ui.editor.hidden = false
    setCounts()
    ui.a.focus()
}

// ---------- Navigation

function jump(step: number) {
    const rows = [...ui.diff.querySelectorAll<HTMLElement>('[data-change]')]
    if (!rows.length) return
    changeIndex = (changeIndex + step + rows.length) % rows.length
    const row = rows[changeIndex]
    row.scrollIntoView({ block: 'center', behavior: still.matches ? 'auto' : 'smooth' })
    row.focus({ preventScroll: true })
}

// ---------- View

function syncView() {
    const current = view()
    ui.splitBtn.disabled = !wide.matches
    ui.splitBtn.title = wide.matches ? 'Side by side' : 'Side by side needs a wider screen'
    ui.splitBtn.setAttribute('aria-pressed', String(current === 'split'))
    ui.unifiedBtn.setAttribute('aria-pressed', String(current === 'unified'))
}

function setView(next: View) {
    preferred = next
    syncView()
    if (last) render(ui.diff, last.rows, last.a, last.b, view())
}

// ---------- Input state

function setCounts() {
    if (!ui.a.value && !ui.b.value) {
        ui.status.textContent = 'Paste two texts to compare'
        return
    }
    const a = splitLines(ui.a.value).length
    const b = splitLines(ui.b.value).length
    ui.status.textContent = `${a} and ${b} lines`
}

async function readFile(input: HTMLInputElement, target: HTMLTextAreaElement) {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (file.size > MAX_FILE) {
        ui.status.textContent = 'That file is over 2 MB. Paste the part you need instead.'
        return
    }
    target.value = await file.text()
    setCounts()
}

// ---------- Events

ui.compareBtn.addEventListener('click', () => void run())
ui.editBtn.addEventListener('click', edit)
ui.prevBtn.addEventListener('click', () => jump(-1))
ui.nextBtn.addEventListener('click', () => jump(1))
ui.splitBtn.addEventListener('click', () => setView('split'))
ui.unifiedBtn.addEventListener('click', () => setView('unified'))

ui.wsBtn.addEventListener('click', () => {
    ignoreWhitespace = !ignoreWhitespace
    ui.wsBtn.setAttribute('aria-pressed', String(ignoreWhitespace))
    if (last || !ui.result.hidden) void run()
})

ui.swapBtn.addEventListener('click', () => {
    const a = ui.a.value
    ui.a.value = ui.b.value
    ui.b.value = a
    if (last) void run()
})

ui.clearBtn.addEventListener('click', () => {
    ui.a.value = ''
    ui.b.value = ''
    last = null
    ui.result.hidden = true
    ui.diff.replaceChildren()
    setCounts()
    ui.a.focus()
})

ui.aFile.addEventListener('change', () => void readFile(ui.aFile, ui.a))
ui.bFile.addEventListener('change', () => void readFile(ui.bFile, ui.b))

for (const field of [ui.a, ui.b]) {
    field.addEventListener('input', setCounts)
    field.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void run()
        }
    })
}

wide.addEventListener('change', () => {
    syncView()
    if (last) render(ui.diff, last.rows, last.a, last.b, view())
})

syncView()
setCounts()
