/** First-run defaults for the Garh Jaisal Haveli restaurant deployment. */
export const GARH_JAISAL_PROFILE = {
  id: 'garh-jaisal',
  hotelName: 'Garh Jaisal Haveli',
  businessName: "Garh Jaisal's Kitchen",
  businessAddress: 'Inside fort kotari para, Jaisalmer',
  businessPhone: '+917727047567',
  country: 'IN',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  language: 'en',
  instagramHandle: '@garhjaisal',
  serviceModel: 'finedine',
  billingType: 'postpaid',
  // Accountant confirmation is pending. Do not persist "unregistered" as a business fact.
  // The setup route records a separate pending state and does not activate a rate or pack.
  taxRegistered: null,
  tablesRequired: true,
  tableCount: 10,
  // This deployment uses printed KOTs and a physical KOT holder, not a KDS.
  kdsEnabled: false,
  serverAppEnabled: true,
  splitChecksEnabled: true,
  roomNumberEnabled: true,
  paymentMethods: ['Cash', 'Card', 'UPI'],
  rolePermissionOverrides: [
    {
      role: 'manager',
      permissionId: 'reports.financial.view',
    },
  ],
} as const;
