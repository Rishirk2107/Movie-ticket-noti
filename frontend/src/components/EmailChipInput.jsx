import React, { useState } from 'react'

export default function EmailChipInput({ emails = [], onChange }) {
  const [inputVal, setInputVal] = useState('')

  const handleAdd = (value) => {
    const trimmed = value.trim().replace(/^,+|,+$/g, '')
    if (!trimmed) return
    // Support multiple comma/space separated emails pasted in
    const parts = trimmed.split(/[\s,]+/).filter(Boolean)
    const newEmails = [...emails]
    for (const email of parts) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !newEmails.includes(email)) {
        newEmails.push(email)
      }
    }
    onChange(newEmails)
    setInputVal('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault()
      handleAdd(inputVal)
    } else if (e.key === 'Backspace' && !inputVal && emails.length > 0) {
      handleRemove(emails.length - 1)
    }
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text')
    handleAdd(text)
  }

  const handleRemove = (index) => {
    const updated = emails.filter((_, i) => i !== index)
    onChange(updated)
  }

  return (
    <div
      className="email-chips-container"
      onClick={() => {
        document.getElementById('email-input-field')?.focus()
      }}
    >
      {emails.map((email, idx) => (
        <span key={idx} className="email-chip">
          {email}
          <button
            type="button"
            className="chip-remove"
            onClick={(e) => {
              e.stopPropagation()
              handleRemove(idx)
            }}
            title="Remove email"
          >
            &times;
          </button>
        </span>
      ))}
      <input
        id="email-input-field"
        type="email"
        className="email-chip-input"
        placeholder={emails.length === 0 ? "Enter email(s) and press Enter or comma..." : ""}
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => handleAdd(inputVal)}
      />
    </div>
  )
}
