import { describe, expect, it } from 'vitest'
import { parseTicketCodes } from './TicketsPage'

describe('ticketcodes inlezen', () => {
  it('één per regel, hoofdletters, zonder dubbele', () => {
    expect(parseTicketCodes('abcd-1234\nABCD-1234\n\nEFGH-5678\n')).toEqual(['ABCD-1234', 'EFGH-5678'])
  })

  it('eerste kolom van een CSV', () => {
    expect(parseTicketCodes('code;naam\nTICKET-0001;Anna\nTICKET-0002,Bram')).toEqual(['TICKET-0001', 'TICKET-0002'])
  })

  it('slaat ongeldige regels over', () => {
    expect(parseTicketCodes('kort\n<script>alert(1)</script>\nGOED-12345')).toEqual(['GOED-12345'])
  })
})
