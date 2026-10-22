# Customer address book API

All routes are under `/api/v1` and require a logged-in `CUSTOMER` session. Responses use the existing `{data,requestId}` envelope.

`GET /customer/addresses` returns `{items, bookRevision, limit:20}` and excludes soft-deleted rows. `GET /customer/addresses/:id` returns the caller's address fact, including a soft-deleted address for recovery review.

`POST /customer/addresses` accepts `expectedBookRevision`, address fields, and an `Idempotency-Key`. `PUT /customer/addresses/:id` additionally accepts `expectedRevision`; `POST /:id/default` and `POST /:id/delete` accept both expected revisions. Mutations return an operation receipt and current address view. Replaying the same key and canonical body returns `replayed:true`; changing the body returns `409 IDEMPOTENCY_CONFLICT`.

Address points are strict WGS84 objects with integer microdegrees and an explicit UTC confirmation timestamp. Names, regions and details are trimmed and bounded; phone numbers must match mainland China mobile format. The service enforces one default, twenty active addresses, soft deletion, per-book CAS revisions, and user ownership in a serializable transaction.
