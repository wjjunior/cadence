import { createBrowserRouter } from 'react-router-dom';

import { ConversationDetailPage } from '@/pages/conversation-detail';

import { AppLayout } from './layout';

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <ConversationDetailPage /> },
      { path: 'c/:id', element: <ConversationDetailPage /> },
    ],
  },
]);
