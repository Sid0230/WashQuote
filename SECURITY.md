# Security Policy

## Reporting a vulnerability

Please do not disclose security vulnerabilities in a public GitHub issue. Report suspected security issues privately through the contact method listed on the WashQuote website. Include the affected URL, reproduction steps, impact, and relevant evidence.

## Customer data

WashQuote quote data is stored locally in the customer's private browser workspace in the current Starter calculator. Customer quote contents must never be committed to this repository, analytics events, or public issue reports.

## Secrets

Never commit Cloudflare API tokens, passwords, private keys, database credentials, environment files, or other secrets. Use GitHub Actions Secrets or Cloudflare-managed secrets.
