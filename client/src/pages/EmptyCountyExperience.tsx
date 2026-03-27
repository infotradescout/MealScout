import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AlertCircle, Heart, MapPin, MessageSquare } from 'lucide-react';
import { apiUrl } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface EmptyCountyProps {
  county: string;
  state: string;
}

export default function EmptyCountyExperience({ county, state }: EmptyCountyProps) {
  const [submitDialog, setSubmitDialog] = useState(false);
  const [formData, setFormData] = useState({
    restaurantName: '',
    address: '',
    website: '',
    phoneNumber: '',
    category: '',
    description: '',
  });

  const { data: metrics } = useQuery({
    queryKey: ['county-metrics', county, state],
    queryFn: async () => {
      const res = await fetch(
        `/api/affiliate/county/empty-check?county=${county}&state=${state}`,
      );
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch(apiUrl('/api/affiliate/submit-restaurant'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, county, state }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to submit');
      return res.json();
    },
    onSuccess: () => {
      setSubmitDialog(false);
      setFormData({
        restaurantName: '',
        address: '',
        website: '',
        phoneNumber: '',
        category: '',
        description: '',
      });
    },
  });

  if (!metrics?.isEmpty) {
    return null; // County has content
  }

  return (
    <div className="space-y-6">
      {/* Step 1: Professional Acknowledgement */}
      <Card className="border-2 border-amber-200 bg-amber-50">
        <CardHeader>
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-1" />
            <div>
              <CardTitle className="text-lg">No MealScout Partners Yet</CardTitle>
              <CardDescription className="mt-2">
                We haven't partnered with restaurants in {county}, {state} yet.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Step 2: Early Backer Reframe */}
      <Card className="border-2 border-[color:var(--accent-text)]/30 bg-[color:var(--accent-text)]/10">
        <CardHeader>
          <div className="flex items-start gap-3">
            <Heart className="w-6 h-6 text-[color:var(--accent-text)] flex-shrink-0 mt-1" />
            <div>
              <CardTitle className="text-lg">You're Early</CardTitle>
              <CardDescription className="mt-2">
                MealScout is just starting in your area. Shape your local food scene —{' '}
                <span className="font-semibold text-[color:var(--accent-text)]">earn money doing it</span>.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Step 3: Community Contribution */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            Help Us Find Great Local Spots
          </CardTitle>
          <CardDescription>
            Know a great restaurant in {county}? Recommend it below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-[color:var(--status-success)]/10 border border-[color:var(--status-success)]/30 rounded-lg p-4">
            <h4 className="font-semibold text-[color:var(--status-success)] mb-2">💰 Get Paid for Recommendations</h4>
            <p className="text-sm text-[color:var(--status-success)]">
              If a restaurant you recommend joins MealScout as a paid partner, you'll earn
              recurring commissions every month they stay active.
            </p>
          </div>

          <Button
            size="lg"
            className="w-full"
            onClick={() => setSubmitDialog(true)}
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Recommend a Restaurant
          </Button>
        </CardContent>
      </Card>

      {/* Step 4: Fallback Content (Nearby/State/National) */}
      <Card>
        <CardHeader>
          <CardTitle>Great Deals Nearby</CardTitle>
          <CardDescription>
            While we build partnerships locally, here are popular deals from around the state
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[color:var(--text-muted)]">
            Featured national offers coming soon...
          </p>
        </CardContent>
      </Card>

      {/* Submission Dialog */}
      <Dialog open={submitDialog} onOpenChange={setSubmitDialog}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Recommend a Restaurant</DialogTitle>
            <DialogDescription>
              Help us discover great local spots in {county}, {state}. If they join MealScout,
              you'll earn recurring commissions!
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Restaurant Name *</label>
                <input
                  type="text"
                  value={formData.restaurantName}
                  onChange={(e) =>
                    setFormData({ ...formData, restaurantName: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-[var(--border-subtle)] rounded-md mt-1"
                  placeholder="e.g., Joe's Pizza"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) =>
                    setFormData({ ...formData, category: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-[var(--border-subtle)] rounded-md mt-1"
                >
                  <option value="">Select category</option>
                  <option value="pizza">Pizza</option>
                  <option value="burger">Burger</option>
                  <option value="sushi">Sushi</option>
                  <option value="chinese">Chinese</option>
                  <option value="mexican">Mexican</option>
                  <option value="italian">Italian</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium">Address</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-3 py-2 border border-[var(--border-subtle)] rounded-md mt-1"
                  placeholder="123 Main St"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Website</label>
                <input
                  type="url"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                  className="w-full px-3 py-2 border border-[var(--border-subtle)] rounded-md mt-1"
                  placeholder="https://..."
                />
              </div>

              <div className="col-span-2">
                <label className="text-sm font-medium">Phone</label>
                <input
                  type="tel"
                  value={formData.phoneNumber}
                  onChange={(e) =>
                    setFormData({ ...formData, phoneNumber: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-[var(--border-subtle)] rounded-md mt-1"
                  placeholder="(555) 123-4567"
                />
              </div>

              <div className="col-span-2">
                <label className="text-sm font-medium">Why do you love this place?</label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={4}
                  className="w-full px-3 py-2 border border-[var(--border-subtle)] rounded-md mt-1"
                  placeholder="Tell us what makes this restaurant special..."
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setSubmitDialog(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={() =>
                  submitMutation.mutate(formData)
                }
                disabled={!formData.restaurantName || submitMutation.isPending}
              >
                Submit Recommendation
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}




