To: support@pasteapp.io
Subject: Lifetime license reverts to "expired" every ~24h — client ignoring key-based license, falling back to legacy StoreKit subscription

Hi Paste team,

I have a lifetime ("Personal Plan" / non-expiring) license that the macOS app
loses roughly every 24 hours, reverting to an unsubscribed/expired state. Using
Settings → Subscription → Manage → Restore fixes it — but only for ~24 hours,
then it resets again the next day. I previously had an annual subscription
(now lapsed); I purchased the lifetime license while that annual subscription
was still active, before it expired.

I did some local investigation and I'm fairly confident this is a client-side
bug in the periodic re-validation path, not a problem with your licensing
records. Details below.

--- Account / license identifiers ---

- Apple ID email: apple@joelpt.net
- Order #: 176365246
- Apple account DSID: 874687553
- App Store storefront: 143441 (USA)
- License key: 5FA0A5A3-4C65-41AE-AA96-3C80BB5497DA
- Activation instance_id: c3398bfd-ade8-4787-99ed-ea0a89654feb
- Activation: "Joel's MacBook Pro", activated 5 Sep 2025 09:04, limit 1, 1/1 used

--- What your own systems report (license is HEALTHY) ---

Your License Details portal for this key shows:
  Status: Active   Expires: Never   Limit: 1   Activations: 1/1 (this Mac)

The app's cached response from hub.pasteapp.io/api/licenses/validate also shows:
  {
    "license_key": "5FA0A5A3-4C65-41AE-AA96-3C80BB5497DA",
    "license_name": "Personal Plan",
    "instance_id": "c3398bfd-ade8-4787-99ed-ea0a89654feb",
    "expires_at": null
  }

So at the licensing layer everything is correct: active, non-expiring, bound
to this machine. The expired item is a *separate* legacy Apple In-App
Purchase (the old annual subscription), which correctly no longer appears in
macOS's StoreKit subscription entitlements.

--- Likely technical explanation ---

Every time the app shows "expired," it is contradicting your own backend,
which still reports the key as Active / Never-expiring. The pattern strongly
suggests the periodic (~24h) re-validation in the macOS client is NOT
re-querying hub.pasteapp.io/api/licenses/validate (or is discarding its
result), and is instead falling back to Apple StoreKit subscription state.
Because my legacy annual IAP is expired and there is no active StoreKit
*subscription* (a lifetime non-consumable correctly does not appear in the
subscription entitlements list), the client downgrades the whole account to
"expired" — overriding the perfectly valid key-based lifetime license.

"Restore" works because it forces the key-based / receipt path to run and
succeed, which is good for ~24h until the next StoreKit-based re-check
silently downgrades it again.

--- What I'd like fixed ---

1. Make the periodic re-validation authoritative on the key-based license:
   if hub.pasteapp.io/api/licenses/validate returns the key as active with
   expires_at: null, the client must NOT downgrade to "expired" based on the
   absence of an active Apple StoreKit subscription.
2. Please confirm on your side that this key is flagged as a permanent /
   lifetime license with no expiry, and that nothing server-side is
   re-associating my account with the lapsed annual subscription.
3. As an interim workaround for me specifically: is there an in-app way to
   enter/pin a license key directly? The current macOS UI shows the key under
   License Details but offers no field to (re)enter one, so I'm dependent on
   the Restore flow as a daily band-aid.

I can provide a screenshot of the License Details portal (Active / Never /
this-Mac) and the cached API response on request.

Thanks,
Joel Thornton
apple@joelpt.net
