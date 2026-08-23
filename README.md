# Gift Card Program

This service activates, funds, balances, and deactivates Cardknox gift cards through a Twilio IVR and an authenticated admin site.

## Data-integrity rules

- A phone number may own multiple gift cards.
- A card number belongs to exactly one `gifts` row.
- Every balance/status mutation matches both the row `id` and exact card number.
- Card operations hold a PostgreSQL row lock, so overlapping IVR/admin/bulk requests cannot operate on the same card simultaneously.
- Funding checks the live gateway balance before issuing and does not opt into duplicate transactions.
- Bulk operations require an exact phone/card match and never update or delete every card for a phone.

## Intended card lifecycle

1. Import `phone,cardnum,amount` or add one card in the admin site.
2. The server immediately checks that exact card in Cardknox, redeems any leftover balance, and deactivates it.
3. Only after that succeeds, the database status becomes `PENDING` and the card is eligible for IVR activation.
4. The verified customer call activates the card and loads its configured amount.

There is no bulk-activation import. If automatic preparation fails, the row is marked `IMPORT_FAILED` and the IVR will not touch it.

## Setup

1. Copy `.env.example` to `.env` and set all secrets.
2. Run `npm install`.
3. Run `npm run db:audit` against the production database and resolve any duplicate card numbers.
4. Back up the database, then run `npm run db:migrate`.
5. Run `npm test` and `npm start`.

Startup runs the integrity migration before opening the HTTP port unless `AUTO_MIGRATE=false`. If duplicate card numbers are detected, startup stops deliberately so unsafe data cannot be processed.

The migration deliberately stops if duplicate card numbers exist. It removes a phone-only unique constraint so multi-card users can be imported, then enforces uniqueness on `cardnum`.

## Admin site

The site supports lookup, live balance refresh, per-card activation/deactivation, activation of all eligible cards for a phone, individual card creation, activity history, CSV import with automatic Cardknox preparation, bulk deactivation, and masked CSV export. Admin APIs use a signed, HttpOnly session cookie; browser `sessionStorage` is not trusted as authentication.

## Required production security work

Set `ADMIN_SESSION_SECRET` to a long random value and `TWILIO_AUTH_TOKEN` to enable webhook signature checks. Rotate the Cardknox gateway key that appeared in older Git history; removing it from the current files does not revoke it or erase it from existing clones.
