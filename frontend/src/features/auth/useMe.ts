import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { getMe, logout } from '../../api/auth';
import { ME_KEY, queryClient } from '../../lib/queryClient';

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: getMe, staleTime: 5 * 60 * 1000 });
}

export function useLogout() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(ME_KEY, null);
      navigate('/login', { replace: true });
    },
    onError: (err) => toast.error(`Logout failed: ${err.message}`),
  });
}
