import { describe, it, expect } from 'vitest';
import { validateInternalRecipients } from '../src/servers/gmail/index';

describe('validateInternalRecipients', () => {
  const domain = 'company.com';

  it('passes when all recipients are internal', () => {
    expect(() =>
      validateInternalRecipients('alice@company.com', 'bob@company.com', 'carol@company.com', domain),
    ).not.toThrow();
  });

  it('passes with a single internal recipient and no cc/bcc', () => {
    expect(() =>
      validateInternalRecipients('alice@company.com', undefined, undefined, domain),
    ).not.toThrow();
  });

  it('rejects when to has an external address', () => {
    expect(() =>
      validateInternalRecipients('external@gmail.com', undefined, undefined, domain),
    ).toThrow('external@gmail.com');
  });

  it('rejects when cc has an external address', () => {
    expect(() =>
      validateInternalRecipients('alice@company.com', 'external@gmail.com', undefined, domain),
    ).toThrow('external@gmail.com');
  });

  it('rejects when bcc has an external address', () => {
    expect(() =>
      validateInternalRecipients('alice@company.com', undefined, 'external@gmail.com', domain),
    ).toThrow('external@gmail.com');
  });

  it('rejects mixed internal/external in a single field', () => {
    expect(() =>
      validateInternalRecipients('alice@company.com, external@gmail.com', undefined, undefined, domain),
    ).toThrow('external@gmail.com');
  });

  it('handles "Name <email>" format', () => {
    expect(() =>
      validateInternalRecipients('Alice <alice@company.com>', 'Bob <bob@company.com>', undefined, domain),
    ).not.toThrow();
  });

  it('rejects "Name <email>" format with external address', () => {
    expect(() =>
      validateInternalRecipients('External User <ext@other.com>', undefined, undefined, domain),
    ).toThrow('ext@other.com');
  });

  it('handles multiple comma-separated recipients', () => {
    expect(() =>
      validateInternalRecipients(
        'alice@company.com, bob@company.com, carol@company.com',
        undefined,
        undefined,
        domain,
      ),
    ).not.toThrow();
  });

  it('lists all external addresses in error message', () => {
    expect(() =>
      validateInternalRecipients(
        'ext1@other.com, alice@company.com',
        'ext2@another.com',
        undefined,
        domain,
      ),
    ).toThrow(/ext1@other.com.*ext2@another.com|ext2@another.com.*ext1@other.com/);
  });

  it('is case-insensitive for domain matching', () => {
    expect(() =>
      validateInternalRecipients('Alice@COMPANY.COM', undefined, undefined, domain),
    ).not.toThrow();
  });

  it('includes domain name in error message', () => {
    expect(() =>
      validateInternalRecipients('ext@other.com', undefined, undefined, domain),
    ).toThrow('@company.com');
  });
});
