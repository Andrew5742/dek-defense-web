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
  converting: 'Конвертація',
  converted: 'Сконвертовано',
  open_error: 'Помилка відкриття',
  error: 'Помилка',
  conversion_required: 'Презентація готова',
  waiting: 'Очікує',
  presenting: 'Доповідає',
  defended: 'Захистився',
  absent: 'Відсутній',
  problem: 'Проблема',
  postponed: 'Перенесено',
  offline: 'Очно',
  online: 'Онлайн',
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
  converting: 'info',
  converted: 'ok',
  open_error: 'bad',
  validating: 'info',
  conversion_required: 'ok',
  error: 'bad',
  problem: 'bad',
  absent: 'bad',
  defended: 'dark',
  presenting: 'info',
  waiting: 'muted',
  postponed: 'warn',
  offline: 'dark',
  online: 'info',
  pending: 'warn',
  running: 'info',
  done: 'ok'
}

export function StatusBadge({ value }: Props) {
  return <span className={`status ${tone[value] || 'muted'}`}>{labels[value] || value}</span>
}
