import { test, expect } from 'bun:test'
import { domainMatches, rootDomain } from '../src/broker'

test('matches subdomains of the saved domain', () => {
  expect(domainMatches('https://accounts.google.com/signin', ['https://google.com'])).toBe(true)
  expect(domainMatches('https://mail.google.com', ['https://www.google.com/login'])).toBe(true)
})

test('rejects lookalike domains', () => {
  expect(domainMatches('https://getgoogle.com/signin', ['https://google.com'])).toBe(false)
  expect(domainMatches('https://google.com.evil.tt', ['https://google.com'])).toBe(false)
  expect(domainMatches('https://gooogle.com', ['https://google.com'])).toBe(false)
})

test('handles multi-part public suffixes', () => {
  expect(rootDomain('https://login.acme.co.uk/x')).toBe('acme.co.uk')
  expect(domainMatches('https://login.acme.co.uk', ['https://acme.co.uk'])).toBe(true)
  expect(domainMatches('https://evil.co.uk', ['https://acme.co.uk'])).toBe(false)
})

test('SSO on a different domain does not silently match', () => {
  // microsoftonline.com != sharepoint.com -> caller must prompt, never auto-fill
  expect(domainMatches('https://login.microsoftonline.com', ['https://contoso.sharepoint.com'])).toBe(false)
})

test('junk input is refused', () => {
  expect(domainMatches('not-a-url', ['https://google.com'])).toBe(false)
  expect(domainMatches('https://google.com', [])).toBe(false)
  expect(domainMatches('http://localhost:8099', ['http://localhost:8099'])).toBe(false) // no eTLD+1
})
