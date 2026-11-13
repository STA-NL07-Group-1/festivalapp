import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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

  it('wachtwoord vergeten: stuurt het e-mailadres en toont altijd dezelfde melding', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /wachtwoord vergeten|forgot password/i }))
    fireEvent.change(screen.getByLabelText(/e-mailadres|email address/i), { target: { value: 'anna@test.nl' } })
    fireEvent.click(screen.getByRole('button', { name: /stuur de mail|send the email/i }))
    expect(await screen.findByText(/bij ons bekend is|is known to us/i)).toBeInTheDocument()
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    const call = calls.find(([url]) => url.endsWith('/auth/forgot-password'))
    expect(call).toBeDefined()
    expect(JSON.parse(String(call![1].body))).toEqual({ email: 'anna@test.nl' })
  })
})
