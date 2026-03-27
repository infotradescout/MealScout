import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Calendar, Check } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";

interface CreateSeriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSeriesCreated: () => void;
}

export function CreateSeriesDialog({ open, onOpenChange, onSeriesCreated }: CreateSeriesDialogProps) {
  const [step, setStep] = useState<"draft" | "preview" | "publish">("draft");
  const [seriesId, setSeriesId] = useState<string | null>(null);
  
  // Draft form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [recurrenceType, setRecurrenceType] = useState<"weekly" | "none">("weekly");
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [defaultStartTime, setDefaultStartTime] = useState("");
  const [defaultEndTime, setDefaultEndTime] = useState("");
  const [defaultMaxTrucks, setDefaultMaxTrucks] = useState(1);
  const [defaultHardCapEnabled, setDefaultHardCapEnabled] = useState(false);
  
  const [previewOccurrences, setPreviewOccurrences] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);

  const dayOptions = [
    { value: "MO", label: "Monday" },
    { value: "TU", label: "Tuesday" },
    { value: "WE", label: "Wednesday" },
    { value: "TH", label: "Thursday" },
    { value: "FR", label: "Friday" },
    { value: "SA", label: "Saturday" },
    { value: "SU", label: "Sunday" },
  ];

  const toggleDay = (day: string) => {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleCreateDraft = async () => {
    setError("");
    setIsSubmitting(true);

    try {
      const recurrenceRule = recurrenceType === "weekly" && selectedDays.length > 0
        ? `WEEKLY:${selectedDays.join(",")}`
        : null;

      const res = await fetch("/api/hosts/event-series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          timezone,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          recurrenceRule,
          defaultStartTime,
          defaultEndTime,
          defaultMaxTrucks,
          defaultHardCapEnabled,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create series");
      }

      const series = await res.json();
      setSeriesId(series.id);
      
      // Generate preview
      generatePreview(series);
      setStep("preview");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const generatePreview = (series: any) => {
    // Client-side preview generation (mirrors server logic)
    const occurrences: any[] = [];
    const start = new Date(series.startDate);
    const end = new Date(series.endDate);

    if (series.recurrenceRule && series.recurrenceRule.startsWith("WEEKLY:")) {
      const daysStr = series.recurrenceRule.split(":")[1];
      const dayMap: { [key: string]: number } = {
        SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
      };
      const days = daysStr.split(",").map((d: string) => dayMap[d]).filter((d: number) => d !== undefined);

      let currentDate = new Date(start);
      while (currentDate <= end) {
        if (days.includes(currentDate.getDay())) {
          occurrences.push({
            date: new Date(currentDate),
            startTime: series.defaultStartTime,
            endTime: series.defaultEndTime,
            maxTrucks: series.defaultMaxTrucks,
            hardCapEnabled: series.defaultHardCapEnabled,
          });
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    } else {
      occurrences.push({
        date: start,
        startTime: series.defaultStartTime,
        endTime: series.defaultEndTime,
        maxTrucks: series.defaultMaxTrucks,
        hardCapEnabled: series.defaultHardCapEnabled,
      });
    }

    setPreviewOccurrences(occurrences.slice(0, 50)); // Limit preview to 50
  };

  const handlePublish = async () => {
    if (!seriesId) return;
    
    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch(`/api/hosts/event-series/${seriesId}/publish`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to publish series");
      }

      setShowPublishConfirm(false);
      onOpenChange(false);
      onSeriesCreated();
      resetForm();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setStep("draft");
    setSeriesId(null);
    setName("");
    setDescription("");
    setTimezone("America/New_York");
    setStartDate("");
    setEndDate("");
    setRecurrenceType("weekly");
    setSelectedDays([]);
    setDefaultStartTime("");
    setDefaultEndTime("");
    setDefaultMaxTrucks(1);
    setDefaultHardCapEnabled(false);
    setPreviewOccurrences([]);
    setError("");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => {
        onOpenChange(isOpen);
        if (!isOpen) resetForm();
      }}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {step === "draft" && "Create Open Call (Series)"}
              {step === "preview" && "Preview Generated Occurrences"}
            </DialogTitle>
            <DialogDescription>
              {step === "draft" && "Create a multi-day or recurring event series for festivals, markets, or regular gatherings."}
              {step === "preview" && "Review the occurrences that will be generated. Once published, trucks can express interest in individual dates."}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {step === "draft" && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="series-name">Series Name</Label>
                <Input
                  id="series-name"
                  placeholder="e.g., Summer Market 2026"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="series-description">Description (Optional)</Label>
                <Input
                  id="series-description"
                  placeholder="Brief description of the series"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/New_York">Eastern Time</SelectItem>
                    <SelectItem value="America/Chicago">Central Time</SelectItem>
                    <SelectItem value="America/Denver">Mountain Time</SelectItem>
                    <SelectItem value="America/Los_Angeles">Pacific Time</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">All occurrences will use this timezone. Cannot be changed after creation.</p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="start-date">Start Date</Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="end-date">End Date</Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    min={startDate || new Date().toISOString().split("T")[0]}
                    required
                  />
                  <p className="text-xs text-slate-500">Maximum 180 days from start date</p>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Recurrence Pattern</Label>
                <Select value={recurrenceType} onValueChange={(v) => setRecurrenceType(v as "weekly" | "none")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly (Select Days)</SelectItem>
                    <SelectItem value="none">None (Single Occurrence)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {recurrenceType === "weekly" && (
                <div className="space-y-2">
                  <Label>Select Days</Label>
                  <div className="flex flex-wrap gap-2">
                    {dayOptions.map((day) => (
                      <Button
                        key={day.value}
                        type="button"
                        variant={selectedDays.includes(day.value) ? "default" : "outline"}
                        size="sm"
                        onClick={() => toggleDay(day.value)}
                      >
                        {selectedDays.includes(day.value) && <Check className="mr-1 h-3 w-3" />}
                        {day.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              <div className="space-y-4">
                <h3 className="font-semibold">Occurrence Defaults</h3>
                <p className="text-sm text-slate-500">These settings will be applied to all generated occurrences.</p>

                <div className="grid md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="default-start-time">Start Time</Label>
                    <Input
                      id="default-start-time"
                      type="time"
                      value={defaultStartTime}
                      onChange={(e) => setDefaultStartTime(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="default-end-time">End Time</Label>
                    <Input
                      id="default-end-time"
                      type="time"
                      value={defaultEndTime}
                      onChange={(e) => setDefaultEndTime(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="default-max-trucks">Max Trucks</Label>
                    <Input
                      id="default-max-trucks"
                      type="number"
                      min="1"
                      max="20"
                      value={defaultMaxTrucks}
                      onChange={(e) => setDefaultMaxTrucks(Number(e.target.value))}
                      required
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-4 border p-4 rounded-md border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                  <Switch
                    id="default-hard-cap"
                    checked={defaultHardCapEnabled}
                    onCheckedChange={setDefaultHardCapEnabled}
                  />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="default-hard-cap" className="font-semibold">Capacity Guard v2.2</Label>
                      <Badge variant="secondary" className="text-xs">Per Occurrence</Badge>
                    </div>
                    <p className="text-sm text-slate-500">
                      Strictly enforces capacity limits on each occurrence. Trucks cannot be accepted once the limit is reached.
                    </p>
                  </div>
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Important</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc list-inside text-sm space-y-1 mt-2">
                    <li>Series will be saved as a draft. Nothing is discoverable until you publish.</li>
                    <li>Trucks express interest per occurrence (individual dates), not the series as a whole.</li>
                    <li>Capacity Guard and acceptance decisions apply per occurrence.</li>
                    <li>No payments or booking guarantees. This is an interest-only system.</li>
                  </ul>
                </AlertDescription>
              </Alert>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4">
              <Alert>
                <Calendar className="h-4 w-4" />
                <AlertTitle>Generated Occurrences</AlertTitle>
                <AlertDescription>
                  {previewOccurrences.length} occurrence{previewOccurrences.length !== 1 ? "s" : ""} will be created.
                  {previewOccurrences.length > 50 && " (Showing first 50)"}
                </AlertDescription>
              </Alert>

              <div className="max-h-96 overflow-y-auto space-y-2 border rounded-md p-4">
                {previewOccurrences.map((occ, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-[var(--bg-surface)] rounded-md text-sm">
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-slate-500" />
                      <span className="font-medium">{format(occ.date, "EEEE, MMMM d, yyyy")}</span>
                    </div>
                    <div className="flex items-center gap-4 text-[color:var(--text-muted)]">
                      <span>{occ.startTime} - {occ.endTime}</span>
                      <span>{occ.maxTrucks} trucks</span>
                      {occ.hardCapEnabled && (
                        <Badge variant="secondary" className="text-xs">Strict Cap</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Before Publishing</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc list-inside text-sm space-y-1 mt-2">
                    <li>Once published, trucks can discover and express interest in individual occurrences.</li>
                    <li>You'll manage interests and acceptances per occurrence through your dashboard.</li>
                    <li>Edits to defaults won't change already-generated occurrences.</li>
                  </ul>
                </AlertDescription>
              </Alert>
            </div>
          )}

          <DialogFooter>
            {step === "draft" && (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateDraft} disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Preview Occurrences"}
                </Button>
              </>
            )}
            {step === "preview" && (
              <>
                <Button variant="outline" onClick={() => setStep("draft")}>
                  Back to Edit
                </Button>
                <Button onClick={() => setShowPublishConfirm(true)} disabled={isSubmitting}>
                  Publish Series
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showPublishConfirm} onOpenChange={setShowPublishConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish Series?</AlertDialogTitle>
            <AlertDialogDescription>
              This will make all {previewOccurrences.length} occurrence{previewOccurrences.length !== 1 ? "s" : ""} discoverable to trucks.
              Trucks can then express interest in individual dates. You'll manage each occurrence separately from your dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePublish} disabled={isSubmitting}>
              {isSubmitting ? "Publishing..." : "Publish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

