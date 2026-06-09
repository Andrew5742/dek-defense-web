import type { DefenseStatus, PresentationStatus, RegistrationStatus } from '../shared/types'

type Props = { value: RegistrationStatus | PresentationStatus | DefenseStatus | string }

const labels: Record<string, string> = {
  not_registered: 'Не записаний',
  started: 'Почато',
  registered: 'Записаний',
  manually_added: 'Додано вручну',
  late_registered: 'Пізній запис',
  missing: 'Немає презентації',
  uploading: 'Завантаження',
  uploaded: 'Завантажено',
  validating: 'Перевірка',
  ready: 'Презентація готова',
  error: 'Помилка',
  conversion_required: 'Потрібна конвертація',
  waiting: 'Очікує',
  presenting: 'Доповідає',
  defended: 'Захистився',
  absent: 'Відсутній',
  problem: 'Проблема',
  postponed: 'Перенесено',
  pending: 'Очікує команду',
  running: 'Виконується',
  done: 'Виконано'
}

const tone: Record<string, string> = {
  not_registered: 'muted',
  missing: 'warn',
  started: 'warn',
  uploaded: 'info',
  registered: 'info',
  manually_added: 'info',
  late_registered: 'warn',
  ready: 'ok',
  validating: 'info',
  conversion_required: 'warn',
  error: 'bad',
  problem: 'bad',
  absent: 'bad',
  defended: 'dark',
  presenting: 'info',
  waiting: 'muted',
  postponed: 'warn',
  pending: 'warn',
  running: 'info',
  done: 'ok'
}

export function StatusBadge({ value }: Props) {
  return <span className={`status ${tone[value] || 'muted'}`}>{labels[value] || value}</span>
}
