import OwnerOrdersWorkspace from "@/components/owner-orders-workspace";

/**
 * Focused fulfillment view for the selected business. The shared Orders
 * workspace owns data, permissions, status transitions, and responsive states.
 */
export default function KitchenDisplayPage() {
  return <OwnerOrdersWorkspace view="kitchen" />;
}
