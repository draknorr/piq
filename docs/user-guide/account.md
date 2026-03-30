# Account Guide

This guide covers sign-in, account access, and credit visibility in PublisherIQ.

## Signing In

PublisherIQ uses invite-only email OTPs on `/login`.

### Login Flow

1. Go to `/login`
2. Enter your approved email address
3. Check your inbox for the **8-digit code**
4. Enter the code within 10 minutes
5. If you came from a protected page, you return there through `?next=...`

### OTP Details

| Setting | Value |
|---------|-------|
| Code length | 8 digits |
| Code expiry | 10 minutes |
| Resend cooldown | 60 seconds |
| Failed-attempt limit | 3 attempts per 15 minutes |

### Important Notes

- Access is invite-only. Unapproved emails are directed to `/waitlist`.
- PublisherIQ waits for a fully established browser session before redirecting after verification.
- `/auth/callback` and `/auth/confirm` still exist for callback compatibility, but the main UX is OTP entry on `/login`.

## Accessing Your Account

Open `/account` from the signed-in navigation.

## What The Account Page Shows

The account page currently shows:

| Field | Description |
|-------|-------------|
| **Credit Balance** | Credits currently available for chat |
| **Email** | Login email address |
| **Name** | Display name, if present |
| **Organization** | Organization, if present |
| **Messages sent** | Total chat messages sent |
| **Total credits used** | Lifetime chat credits consumed |

## Recent Activity

The page also shows the 10 most recent credit transactions, including:

| Type | Meaning |
|------|---------|
| `signup_bonus` | Initial credits added at signup |
| `admin_grant` | Credits added by an administrator |
| `admin_deduct` | Credits removed by an administrator |
| `chat_usage` | Finalized chat usage charge |
| `refund` | Refunded reservation after a failed or cancelled run |

## Sign Out

Use the **Sign Out** action on `/account` to clear the session and return to `/login`.

## Related Documentation

- [Credit System](./credit-system.md)
- [Chat Interface](./chat-interface.md)
- [Troubleshooting](../admin-guide/troubleshooting.md)
