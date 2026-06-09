import mammoth from 'mammoth'
import type { ImportDraftStudent, ImportReview } from '../shared/types'
import { normalizeText, uid, nowIso } from '../shared/utils'

function extractDocMeta(text: string) {
  const specialty = text.match(/спеціальності\s+(\d+)\s+[–-]\s+«([^»]+)»/i)
  const educationProgram = text.match(/Назва освітньої програми\s+«([^»]+)»/i)
  const studyForm = text.match(/Форма здобуття освіти\s+([^\n\r]+)/i)
  const group = text.match(/Шифр академічної групи\s+([А-ЯІЇЄҐA-Z0-9\-–_]+)/i)
  return {
    specialtyCode: specialty?.[1]?.trim(),
    specialtyName: specialty?.[2]?.trim(),
    educationProgram: educationProgram?.[1]?.trim(),
    studyForm: studyForm?.[1] ? normalizeText(studyForm[1]) : undefined,
    groupName: group?.[1]?.replace('–', '-').trim() || 'Без групи'
  }
}

function splitConsultant(supervisorRaw: string) {
  const consultantMatch = supervisorRaw.match(/\(\s*консультант\s+([^\)]+)\)/i)
  const consultant = consultantMatch ? normalizeText(consultantMatch[1]) : undefined
  const supervisor = normalizeText(supervisorRaw.replace(/\(\s*консультант[^\)]*\)/gi, ''))
  return { supervisor, consultant }
}

function parseRowsFromHtml(html: string, groupName: string): ImportDraftStudent[] {
  const dom = new DOMParser().parseFromString(html, 'text/html')
  const rows = Array.from(dom.querySelectorAll('tr'))
  const result: ImportDraftStudent[] = []

  for (const tr of rows) {
    const cells = Array.from(tr.querySelectorAll('td,th')).map((td) => normalizeText(td.textContent || ''))
    if (cells.length < 4) continue
    if (!/^\d+\.?$/.test(cells[0])) continue
    const rowNumber = Number.parseInt(cells[0], 10)
    const fullName = normalizeText(cells[1])
    const thesisTitle = normalizeText(cells[2])
    const { supervisor, consultant } = splitConsultant(cells[3])
    if (!fullName || !thesisTitle || !supervisor) continue
    result.push({
      tempId: uid('draft'),
      selected: true,
      rowNumber,
      fullName,
      groupName,
      thesisTitle,
      supervisor,
      consultant,
      warning: fullName.split(' ').length < 2 ? 'Перевірити ПІБ' : undefined
    })
  }
  return result
}

function parseRowsFromPlainText(text: string, groupName: string): ImportDraftStudent[] {
  const lines = text.split(/\r?\n/).map(normalizeText).filter(Boolean)
  const result: ImportDraftStudent[] = []
  const rowStarts: number[] = []
  lines.forEach((line, idx) => {
    if (/^\d+\.?$/.test(line)) rowStarts.push(idx)
  })

  for (let i = 0; i < rowStarts.length; i++) {
    const start = rowStarts[i]
    const end = rowStarts[i + 1] ?? lines.length
    const chunk = lines.slice(start, end)
    const rowNumber = Number.parseInt(chunk[0], 10)
    const payload = chunk.slice(1)
    if (payload.length < 3) continue

    const supervisorIdx = payload.findIndex((x) => /(к\.т\.н|д\.т\.н|д\.ф|доцент|професор|асистент|викл|Кисіль|Павлова|Гнатчук|Медзатий|Войчур|Говорущенко)/i.test(x))
    const fullNameParts = payload.slice(0, Math.min(3, supervisorIdx > 0 ? supervisorIdx : 3))
    const fullName = normalizeText(fullNameParts.join(' '))
    const thesisParts = supervisorIdx > 0 ? payload.slice(fullNameParts.length, supervisorIdx) : payload.slice(fullNameParts.length, -1)
    const supervisorRaw = supervisorIdx > 0 ? payload.slice(supervisorIdx).join(' ') : payload[payload.length - 1]
    const { supervisor, consultant } = splitConsultant(supervisorRaw)
    const thesisTitle = normalizeText(thesisParts.join(' '))
    if (!fullName || !thesisTitle || !supervisor) continue
    result.push({
      tempId: uid('draft'),
      selected: true,
      rowNumber,
      fullName,
      groupName,
      thesisTitle,
      supervisor,
      consultant,
      warning: 'Розпізнано з plain text — перевірити'
    })
  }

  return result
}

export async function importDocx(file: File, sessionId: string): Promise<ImportReview> {
  const buffer = await file.arrayBuffer()
  const htmlResult = await mammoth.convertToHtml({ arrayBuffer: buffer })
  const textResult = await mammoth.extractRawText({ arrayBuffer: buffer })
  const meta = extractDocMeta(textResult.value)
  const fromHtml = parseRowsFromHtml(htmlResult.value, meta.groupName)
  const students = fromHtml.length ? fromHtml : parseRowsFromPlainText(textResult.value, meta.groupName)

  return {
    id: uid('import'),
    sessionId,
    sourceName: file.name,
    ...meta,
    students,
    createdAt: nowIso()
  }
}

export function importFromPastedText(text: string, sessionId: string): ImportReview {
  const meta = extractDocMeta(text)
  return {
    id: uid('import'),
    sessionId,
    sourceName: 'Вставлений текст',
    ...meta,
    students: parseRowsFromPlainText(text, meta.groupName),
    createdAt: nowIso()
  }
}
