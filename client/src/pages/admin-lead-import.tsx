import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Send,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type ImportType = "host_event" | "restaurant_menu" | "food_truck" | "account";

const endpointByType: Record<ImportType, string> = {
  host_event: "/api/admin/lead-import/host-event",
  restaurant_menu: "/api/admin/lead-import/restaurant-menu",
  food_truck: "/api/admin/lead-import/food-truck",
  account: "/api/admin/lead-import/account",
};

const samples: Record<ImportType, string> = {
  host_event: JSON.stringify(
    {
      type: "host_event",
      source: "chatgpt_screenshot",
      sendVerificationEmail: true,
      user: {
        firstName: "Hannah",
        lastName: "",
        email: "hannah@example.com",
        phone: "",
      },
      host: {
        name: "Altura Perdido",
        category: "event_space",
        website: "",
        address: "123 Example St",
        city: "Pensacola",
        state: "FL",
        zip: "",
        contactName: "Hannah",
        contactTitle: "Event Lead",
        contactEmail: "hannah@example.com",
        contactPhone: "",
      },
      eventRequest: {
        eventName: "Cinco de Mayo",
        eventDate: "2026-05-05",
        startTime: "17:00",
        endTime: "21:00",
        requestedVendorType: "taco truck",
        requestSummary: "One taco truck requested for an evening event.",
        requestedDetailsFromTruck: ["menu", "pricing", "availability"],
        missingFields: [],
      },
      rawSource: {},
    },
    null,
    2,
  ),
  restaurant_menu: JSON.stringify(
    {
      type: "restaurant_menu",
      source: "chatgpt_screenshot",
      sendVerificationEmail: false,
      user: {
        firstName: "Owner",
        lastName: "",
        email: "owner@example.com",
        phone: "",
      },
      restaurant: {
        name: "Example Kitchen",
        address: "456 Main St",
        city: "Pensacola",
        state: "FL",
        phone: "",
        cuisineType: "Mexican",
        websiteUrl: "",
        menuUrl: "",
      },
      menu: {
        name: "Main Menu",
        serviceType: "all",
        importUrl: "",
        items: [
          {
            name: "Street Tacos",
            description: "Three tacos with salsa",
            price: "12.00",
            category: "Tacos",
          },
        ],
      },
      rawSource: {},
    },
    null,
    2,
  ),
  food_truck: JSON.stringify(
    {
      type: "food_truck",
      source: "chatgpt_screenshot",
      sendVerificationEmail: true,
      user: {
        firstName: "Truck",
        lastName: "Owner",
        email: "truck@example.com",
        phone: "",
      },
      truck: {
        name: "Example Taco Truck",
        address: "789 Commissary Rd",
        city: "Pensacola",
        state: "FL",
        phone: "",
        cuisineType: "Tacos",
        websiteUrl: "",
        menuUrl: "",
      },
      menu: {
        name: "Truck Menu",
        serviceType: "all",
        items: [
          {
            name: "Birria Tacos",
            description: "",
            price: "14.00",
            category: "Tacos",
          },
        ],
      },
      rawSource: {},
    },
    null,
    2,
  ),
  account: JSON.stringify(
    {
      type: "account",
      source: "chatgpt_screenshot",
      sendVerificationEmail: true,
      user: {
        firstName: "New",
        lastName: "Lead",
        email: "lead@example.com",
        phone: "",
        userType: "customer",
      },
      rawSource: {},
    },
    null,
    2,
  ),
};

async function postJson(path: string, payload: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.message || body?.error || "Request failed");
  }
  return body;
}

function inferType(value: unknown, fallback: ImportType): ImportType {
  const type = String((value as any)?.type || "");
  return ["host_event", "restaurant_menu", "food_truck", "account"].includes(type)
    ? (type as ImportType)
    : fallback;
}

export default function AdminLeadImport() {
  const { toast } = useToast();
  const [importType, setImportType] = useState<ImportType>("host_event");
  const [jsonText, setJsonText] = useState(samples.host_event);
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);

  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(jsonText) };
    } catch (error: any) {
      return { ok: false as const, error: error?.message || "Invalid JSON" };
    }
  }, [jsonText]);

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!parsed.ok) throw new Error(parsed.error);
      return postJson("/api/admin/lead-import/preview", {
        ...parsed.value,
        type: inferType(parsed.value, importType),
      });
    },
    onSuccess: (data) => {
      setPreview(data);
      setResult(null);
    },
    onError: (error: Error) => {
      toast({ title: "Preview failed", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!parsed.ok) throw new Error(parsed.error);
      const type = inferType(parsed.value, importType);
      return postJson(endpointByType[type], { ...parsed.value, type });
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: "Import complete", description: "MealScout records were updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const loadSample = (nextType: ImportType) => {
    setImportType(nextType);
    setJsonText(samples[nextType]);
    setPreview(null);
    setResult(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-bold tracking-tight">Lead Import</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Screenshot intake for accounts, menus, food trucks, and host events.
            </p>
          </div>
          <Badge variant="secondary">Staff</Badge>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <Card>
            <CardHeader>
              <CardTitle>Import Payload</CardTitle>
              <CardDescription>Validated JSON only writes after Import.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-[240px_1fr]">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={importType} onValueChange={(value) => loadSample(value as ImportType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="host_event">Host event</SelectItem>
                      <SelectItem value="restaurant_menu">Restaurant menu</SelectItem>
                      <SelectItem value="food_truck">Food truck</SelectItem>
                      <SelectItem value="account">Account</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => loadSample(importType)}
                  >
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                    Sample
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!parsed.ok || previewMutation.isPending}
                    onClick={() => previewMutation.mutate()}
                  >
                    {previewMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Preview
                  </Button>
                  <Button
                    type="button"
                    disabled={!parsed.ok || importMutation.isPending}
                    onClick={() => importMutation.mutate()}
                  >
                    {importMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Import
                  </Button>
                </div>
              </div>

              {!parsed.ok ? (
                <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {parsed.error}
                </div>
              ) : null}

              <Textarea
                value={jsonText}
                onChange={(event) => setJsonText(event.target.value)}
                spellCheck={false}
                className="min-h-[560px] font-mono text-xs"
              />
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Preview</CardTitle>
                <CardDescription>Resolved operations before write.</CardDescription>
              </CardHeader>
              <CardContent>
                {preview ? (
                  <div className="space-y-3">
                    {(preview.actions || []).map((action: string) => (
                      <div key={action} className="rounded-md border px-3 py-2 text-sm">
                        {action}
                      </div>
                    ))}
                    {(preview.warnings || []).map((warning: string) => (
                      <div
                        key={warning}
                        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                      >
                        {warning}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No preview yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Result</CardTitle>
                <CardDescription>Created and reused record IDs.</CardDescription>
              </CardHeader>
              <CardContent>
                {result ? (
                  <pre className="max-h-[420px] overflow-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">No import result yet.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
