import { useState } from 'react'
import type { Student } from '../shared/types'

type Props = {
  student: Student
  onSave: (patch: Partial<Student>) => void
  onClose: () => void
}

export function StudentEditor({ student, onSave, onClose }: Props) {
  const [fullName, setFullName] = useState(student.fullName)
  const [groupName, setGroupName] = useState(student.groupName)
  const [thesisTitleEdited, setThesisTitleEdited] = useState(student.thesisTitleEdited)
  const [supervisorEdited, setSupervisorEdited] = useState(student.supervisorEdited)
  const [consultant, setConsultant] = useState(student.consultant || '')
  const [notes, setNotes] = useState(student.notes || '')
  const [isAllowedToRegister, setAllowed] = useState(student.isAllowedToRegister)

  return (
    <div className="modal-backdrop">
      <div className="modal wide">
        <div className="modal-head">
          <h3>Редагування студента</h3>
          <button onClick={onClose}>×</button>
        </div>
        <div className="form-grid">
          <label>ПІБ<input value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
          <label>Група<input value={groupName} onChange={(e) => setGroupName(e.target.value)} /></label>
          <label className="span2">Тема роботи<textarea value={thesisTitleEdited} onChange={(e) => setThesisTitleEdited(e.target.value)} /></label>
          <label>Керівник<input value={supervisorEdited} onChange={(e) => setSupervisorEdited(e.target.value)} /></label>
          <label>Консультант<input value={consultant} onChange={(e) => setConsultant(e.target.value)} /></label>
          <label className="span2">Примітки<textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={isAllowedToRegister} onChange={(e) => setAllowed(e.target.checked)} /> Допускати до запису</label>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Скасувати</button>
          <button className="primary" onClick={() => onSave({ fullName, groupName, thesisTitleEdited, supervisorEdited, consultant: consultant || undefined, notes, isAllowedToRegister })}>Зберегти</button>
        </div>
      </div>
    </div>
  )
}
