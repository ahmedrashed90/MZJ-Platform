export type NullableNumber = number | null;

export type DashboardData = {
  connected: boolean;
  generatedAt: string;
  sectionErrors?: Record<string, string>;
  crm: {
    totalCustomers: NullableNumber;
    openConversations: NullableNumber;
    openCashConversations: NullableNumber;
    openFinanceConversations: NullableNumber;
    openServiceConversations: NullableNumber;
    noAnswerCustomers: NullableNumber;
    sold: NullableNumber;
    cashSales: NullableNumber;
    financeSales: NullableNumber;
    customerService: NullableNumber;
    newToday: NullableNumber;
    newThisWeek: NullableNumber;
    recentConversations: Array<{
      id: string;
      customerName: string;
      preview: string;
      time: string;
      unreadCount: number;
      leadId: string;
      department: "cash" | "finance" | "service";
    }>;
    newCustomersSeries: Array<{ label: string; value: number }>;
  };
  marketing: {
    campaigns: NullableNumber;
    scheduled: NullableNumber;
    delayed: NullableNumber;
  };
  tracking: {
    requests: NullableNumber;
    inProgress: NullableNumber;
    completed: NullableNumber;
  };
  operations: {
    inventory: {
      actualTotal: NullableNumber;
      agency: NullableNumber;
      availableForSale: NullableNumber;
      reserved: NullableNumber;
      underDelivery: NullableNumber;
      delivered: NullableNumber;
      hasNotes: NullableNumber;
    };
    locations: Array<{
      key: string;
      name: string;
      actualTotal: NullableNumber;
      underDelivery: NullableNumber;
      availableForSale: NullableNumber;
      reserved: NullableNumber;
      delivered: NullableNumber;
      hasNotes: NullableNumber;
    }>;
    approvals: {
      total: NullableNumber;
      missingFinancial: NullableNumber;
      missingAdministrative: NullableNumber;
      completed: NullableNumber;
    };
    shortages: {
      total: NullableNumber;
      multaqa: NullableNumber;
      hall: NullableNumber;
      qadisiyah: NullableNumber;
    };
    transfers: {
      total: NullableNumber;
      transferTotal: NullableNumber;
      photographyTotal: NullableNumber;
      requestReceived: NullableNumber;
      vehicleReceived: NullableNumber;
      vehicleSent: NullableNumber;
      completed: NullableNumber;
    };
    salesTracking: {
      total: NullableNumber;
      notStarted: NullableNumber;
      inProgress: NullableNumber;
      completed: NullableNumber;
    };
  };
};
