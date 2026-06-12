import { useQuery } from '@tanstack/react-query';

import { SimulateForm } from '@/features/simulate-inbound';
import { fetchConfig, queryKeys } from '@/shared/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui';

export function SimulatePanel() {
  const config = useQuery({
    queryKey: queryKeys.config,
    queryFn: fetchConfig,
    staleTime: Infinity,
  });

  if (config.data?.smsProvider !== 'mock') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Simulate inbound</CardTitle>
      </CardHeader>
      <CardContent>
        <SimulateForm />
      </CardContent>
    </Card>
  );
}
