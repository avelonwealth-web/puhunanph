# Firestore Rules Test Checklist

Use this with **Firebase Console -> Firestore -> Rules -> Rules Playground**.

Set auth context per test:
- `Unauthenticated`
- `Authenticated user` with UID: `userA`
- `Authenticated user` with UID: `adminA`

Prepare fixture docs:
- `/users/userA` with `{ uid: "userA", mobile: "09123456789", isAdmin: false }`
- `/users/adminA` with `{ uid: "adminA", mobile: "09152444480", isAdmin: true }`
- `/investments/inv1` with `{ userId: "userA", amount: 1000, status: "active" }`
- `/withdraws/w1` with `{ userId: "userA", mobileNumber: "0912...", accountNumber: "123", amount: 100, status: "pending" }`
- `/logs/l1` with `{ userId: "userA", type: "deposit", message: "ok" }`

---

## 1) Unauthenticated Access

- **Read user doc**
  - Path: `/users/userA`
  - Auth: unauthenticated
  - Expect: **DENY**

- **Read investments**
  - Path: `/investments/inv1`
  - Auth: unauthenticated
  - Expect: **DENY**

---

## 2) User Owner Access (`uid=userA`)

- **Read own user doc**
  - Path: `/users/userA`
  - Operation: `get`
  - Expect: **ALLOW**

- **Read other user doc**
  - Path: `/users/adminA`
  - Operation: `get`
  - Expect: **DENY**

- **Create own investment**
  - Path: `/investments/newInv`
  - Operation: `create`
  - Data: `{ userId: "userA", amount: 500, status: "active" }`
  - Expect: **ALLOW**

- **Create foreign investment**
  - Path: `/investments/newInv2`
  - Operation: `create`
  - Data: `{ userId: "adminA", amount: 500, status: "active" }`
  - Expect: **DENY**

- **Read own investment**
  - Path: `/investments/inv1`
  - Operation: `get`
  - Expect: **ALLOW**

- **Create own withdraw**
  - Path: `/withdraws/newW`
  - Operation: `create`
  - Data: `{ userId: "userA", mobileNumber: "0912", accountNumber: "123", amount: 100 }`
  - Expect: **ALLOW**

- **Create invalid withdraw (missing mobile/account)**
  - Path: `/withdraws/newW2`
  - Operation: `create`
  - Data: `{ userId: "userA", amount: 100 }`
  - Expect: **DENY**

- **Create own log**
  - Path: `/logs/newLog`
  - Operation: `create`
  - Data: `{ userId: "userA", type: "test", message: "hello" }`
  - Expect: **ALLOW**

- **Create foreign log**
  - Path: `/logs/newLog2`
  - Operation: `create`
  - Data: `{ userId: "adminA", type: "test", message: "hello" }`
  - Expect: **DENY**

---

## 3) Admin Access (`uid=adminA`, `isAdmin=true`)

- **Read any user**
  - Path: `/users/userA`
  - Operation: `get`
  - Expect: **ALLOW**

- **Update any withdraw**
  - Path: `/withdraws/w1`
  - Operation: `update`
  - Data: `{ status: "approved" }`
  - Expect: **ALLOW**

- **Create daily reward**
  - Path: `/dailyRewards/dr1`
  - Operation: `create`
  - Data: `{ userId: "userA", investmentId: "inv1", amount: 100 }`
  - Expect: **ALLOW**

- **Create referral commission**
  - Path: `/referralCommissions/rc1`
  - Operation: `create`
  - Data: `{ userId: "userA", fromUserId: "x", level: 1, amount: 50 }`
  - Expect: **ALLOW**

- **Create product**
  - Path: `/products/p1`
  - Operation: `create`
  - Data: `{ name: "Test", amount: 100, rate: 0.1, duration: 100 }`
  - Expect: **ALLOW**

- **Update setting**
  - Path: `/settings/s1`
  - Operation: `update` (or create first)
  - Data: `{ key: "k", value: "v" }`
  - Expect: **ALLOW**

---

## 4) Non-Admin Restrictions (`uid=userA`)

- **Create product**
  - Path: `/products/p2`
  - Operation: `create`
  - Data: `{ name: "Nope", amount: 100 }`
  - Expect: **DENY**

- **Create daily reward**
  - Path: `/dailyRewards/dr2`
  - Operation: `create`
  - Data: `{ userId: "userA", amount: 100 }`
  - Expect: **DENY**

- **Update referral commission**
  - Path: `/referralCommissions/rc1`
  - Operation: `update`
  - Data: `{ amount: 999 }`
  - Expect: **DENY**

---

## 5) Catch-All Rule

- **Unknown collection write**
  - Path: `/randomCollection/x1`
  - Operation: `create`
  - Data: `{ any: "value" }`
  - Expect: **DENY**

- **Unknown collection read**
  - Path: `/randomCollection/x1`
  - Operation: `get`
  - Expect: **DENY**

---

## Notes

- If an admin test fails, verify `/users/adminA` exists and has `isAdmin: true`.
- If owner tests fail, check that `request.auth.uid` matches the document `userId` or `{uid}`.
- After editing rules, always click **Publish** before retesting.
