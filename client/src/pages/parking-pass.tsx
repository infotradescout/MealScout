import { useSearch } from "wouter";
import ParkingPassContent from "./parking-pass-content";
import { ParkingPassBookingReturn } from "@/components/parking-pass-booking-return";

// Keep the existing discovery, host, schedule and checkout workspace intact.
// A payment return must be reconciled before displaying reservation success.
export default function ParkingPassPage() {
  const search = useSearch();
  if (new URLSearchParams(search).get("booking") === "success") {
    return <ParkingPassBookingReturn search={search} />;
  }
  return <ParkingPassContent />;
}
