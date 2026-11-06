import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('toont het inlogscherm als je niet bent ingelogd', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Festivalapp' })).toBeInTheDocument()
    expect(screen.getByLabelText(/e-mailadres|email address/i)).toBeInTheDocument()
  })

  it('schakelt naar account maken met ticketcode', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /maak er een|create one/i }))
    expect(screen.getByLabelText(/ticketcode|ticket code/i)).toBeInTheDocument()
  })

  it('wisselt van taal op het inlogscherm', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('radio', { name: 'EN' }))
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'NL' }))
    expect(screen.getByLabelText('E-mailadres')).toBeInTheDocument()
  })
})
