import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { createCampaign } from '../../api/campaigns';
import { emailKeys } from '../emails/useEmails';

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: createCampaign,
    onSuccess: ({ totalCount, invalidCount, duplicateCount }) => {
      const skipped = [
        invalidCount && `${invalidCount} invalid`,
        duplicateCount && `${duplicateCount} duplicate`,
      ].filter(Boolean);
      toast.success(`Scheduled ${totalCount.toLocaleString()} ${totalCount === 1 ? 'email' : 'emails'}`, {
        description: skipped.length ? `Skipped ${skipped.join(' and ')} addresses.` : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: emailKeys.all });
      navigate('/scheduled');
    },
    onError: (err) => toast.error("Couldn't schedule the emails", { description: err.message }),
  });
}
