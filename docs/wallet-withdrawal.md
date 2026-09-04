# Wallet withdrawal deployment

Wallet earnings are created only when a paid errand is completed. A withdrawal request reserves the requested balance until it is rejected or WeChat finishes the transfer.

Required production configuration in addition to the existing WeChat Pay V3 credentials:

- `WX_TRANSFER_NOTIFY_URL`: public HTTPS callback URL for `POST /api/v1/wallet/transfer/notify`.

The WeChat merchant account must be eligible for the V3 merchant transfer-to-user API. An administrator with `payment.manage` permission reviews requests in the admin console. Approval immediately creates a one-user transfer batch to the requester's bound WeChat `openid`; the callback marks the request as paid or failed.
