import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';

interface DealFeedbackProps {
  dealId: string;
  compact?: boolean;
}

export function DealFeedback({ dealId, compact = false }: DealFeedbackProps) {
  const { toast } = useToast();
  const [feedbackType, setFeedbackType] = useState<'worked' | 'suggestion' | 'issue'>('worked');
  const [comment, setComment] = useState('');
  const [isHelpful, setIsHelpful] = useState<boolean | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data: stats } = useQuery<{
    totalFeedback: number;
  }>({
    queryKey: ['/api/deals', dealId, 'feedback', 'stats'],
  });

  const submitFeedbackMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest('POST', `/api/deals/${dealId}/feedback`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deals', dealId, 'feedback'] });
      queryClient.invalidateQueries({ queryKey: ['/api/deals', dealId, 'feedback', 'stats'] });
      
      toast({
        title: "Thank you!",
        description: "Your feedback helps us improve deal quality.",
      });
      
      setComment('');
      setFeedbackType('worked');
      setIsHelpful(null);
      setShowForm(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit feedback. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    submitFeedbackMutation.mutate({
      feedbackType,
      comment: comment.trim() || null,
      isHelpful,
    });
  };

  if (compact) {
    return (
      <div 
        className="flex items-center gap-2" 
        data-testid="feedback-compact"
        onClick={(e) => e.stopPropagation()}
      >
        {stats && stats.totalFeedback > 0 && (
          <div className="flex items-center gap-1 text-sm">
            <span className="text-muted-foreground">
              {stats.totalFeedback} response{stats.totalFeedback === 1 ? '' : 's'}
            </span>
          </div>
        )}
        {!showForm ? (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setShowForm(true);
            }}
            className="text-sm font-medium"
            data-testid="button-show-feedback-form"
          >
            Give Feedback
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleSubmit();
              }}
              disabled={submitFeedbackMutation.isPending}
              data-testid="button-submit-feedback"
            >
              {submitFeedbackMutation.isPending ? 'Submitting...' : 'Submit'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setShowForm(false);
              }}
              data-testid="button-cancel-feedback"
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 border rounded-lg" data-testid="feedback-full">
      <div>
        <h3 className="text-lg font-semibold mb-2">Deal Feedback</h3>
        {stats && stats.totalFeedback > 0 && (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm text-muted-foreground">
              {stats.totalFeedback} feedback response{stats.totalFeedback === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>

      <div>
        <Label className="mb-2 block">Feedback Type</Label>
        <RadioGroup
          value={feedbackType}
          onValueChange={(value: any) => setFeedbackType(value)}
          data-testid="feedback-type-selector"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="worked" id="worked" data-testid="radio-worked" />
            <Label htmlFor="worked" className="cursor-pointer">Worked as expected</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="suggestion" id="suggestion" data-testid="radio-suggestion" />
            <Label htmlFor="suggestion" className="cursor-pointer">Suggestion for Improvement</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="issue" id="issue" data-testid="radio-issue" />
            <Label htmlFor="issue" className="cursor-pointer">Report an Issue</Label>
          </div>
        </RadioGroup>
      </div>

      <div>
        <Label className="mb-2 block">Did the deal work as expected?</Label>
        <RadioGroup
          value={isHelpful === null ? '' : isHelpful.toString()}
          onValueChange={(value) => setIsHelpful(value === 'true')}
          data-testid="helpful-selector"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="true" id="helpful-yes" data-testid="radio-helpful-yes" />
            <Label htmlFor="helpful-yes" className="cursor-pointer">Yes</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="false" id="helpful-no" data-testid="radio-helpful-no" />
            <Label htmlFor="helpful-no" className="cursor-pointer">No</Label>
          </div>
        </RadioGroup>
      </div>

      <div>
        <Label htmlFor="comment" className="mb-2 block">
          Additional Comments (Optional)
        </Label>
        <Textarea
          id="comment"
          placeholder="Share your experience with this deal..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
          rows={4}
          data-testid="textarea-comment"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {comment.length}/500 characters
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          onClick={handleSubmit}
          disabled={submitFeedbackMutation.isPending}
          data-testid="button-submit-feedback"
        >
          {submitFeedbackMutation.isPending ? 'Submitting...' : 'Submit Feedback'}
        </Button>
        {(comment || isHelpful !== null || feedbackType !== 'worked') && (
          <Button
            variant="outline"
            onClick={() => {
              setComment('');
              setFeedbackType('worked');
              setIsHelpful(null);
            }}
            data-testid="button-reset-feedback"
          >
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}

