# ADR-0001: One attributed public restaurant listing near IIM Calcutta

- **Status:** Accepted for local discovery only; not a partner integration
- **Date:** 2026-11-12
- **Decision owner:** Project owner approval still required before any partner claim or operational use

## Context

The project owner linked [`public-apis/public-apis`](https://github.com/public-apis/public-apis) and asked for a real restaurant near IIM Calcutta. That repository is a curated directory of API services; it does not hand out API keys. Its Food & Drink section lists IndiaRestros as a keyless API. The IndiaRestros API reference documents a read endpoint for a restaurant record, a 120-requests-per-minute/IP limit, and instructions to cite source listings and not resell contact data in bulk.

A live public-record lookup for **Halla Bowl** returned the Joka listing at **Aristro Club, 680, Diamond Harbour Road, Joka, Kolkata 700104**. The listing record included a public source URL, cuisine labels, contributing-source names and an update timestamp. IIM Calcutta's official contact page gives its campus address on Diamond Harbour Road, Joka. This supports displaying a local discovery card, not asserting a measured walking distance.

## Decision

- Read the single, fixed Halla Bowl record from IndiaRestros' keyless read API in the browser; do not add an API key or accept user-controlled upstream URLs.
- Validate the response shape and the IndiaRestros source URL before rendering it. Show an explicit loading state, a recoverable unavailable state and a retry action; never substitute a fake-success record.
- Show the API record's update time, source attribution, a map search link and a direct link to the source listing.
- State visibly that Halla Bowl is **not** an Annapurna Link partner, has not been contacted or approved, and has no current donation offer on this platform.
- Do not import this listing into the organisation, membership, verification, donation or impact tables. Do not display scraped contact data, ratings or menu data.

## Alternatives considered

1. **Hardcode a restaurant or seed it as a Generator.** Rejected: this could falsely imply consent, verification or participation and would not keep details current.
2. **Integrate a paid map/search API.** Rejected for this one-entry use case; it would add credentials, billing and unnecessary tracking.
3. **Bulk-import public restaurant data.** Rejected: unnecessary for the request and inconsistent with the provider's no-bulk-resale guidance.
4. **Use only an OSM link.** Retained as a directions/search option, but it does not supply restaurant details.

## Risks and limits

- IndiaRestros is an external dependency; availability and returned data can change. The page degrades without inventing a listing.
- The API page describes keyless reads and citation expectations, but a blanket dataset licence was not confirmed during this review. The implementation displays one attributed record only; confirm applicable data-use terms before expanding the directory or reusing photos/contact data.
- The public listing does not verify current operation, food-safety controls, licence status, surplus availability, capacity or willingness to participate.
- The external request is client-side because the coding sandbox's network allowlist excludes the provider host. It relies on the provider's documented open CORS policy; browser end-to-end verification remains outstanding.

## Evidence

- API directory: [public-apis Food & Drink entry](https://github.com/public-apis/public-apis/blob/master/README.md)
- Provider docs: [IndiaRestros API reference](https://indiarestros.com/api/docs)
- Provider record: [Halla Bowl, Joka](https://indiarestros.com/r/halla-bowl-joka-nz0p6wdrgs)
- Campus address: [IIM Calcutta contact page](https://application.iimcal.ac.in/about/contacts)
- Automated validation tests: `tests/indiarestros.test.ts`
