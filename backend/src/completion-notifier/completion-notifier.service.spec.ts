import { CompletionNotifierService } from './completion-notifier.service';

describe('CompletionNotifierService', () => {
  const makeService = () => {
    const prismaService = {
      task: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    const graphService = {
      sendReply: jest.fn(),
    };
    const service = new CompletionNotifierService(
      prismaService as never,
      graphService as never,
    );
    return { service, prismaService, graphService };
  };

  it('builds German completion reply when source is German', async () => {
    const { service } = makeService();
    const body = (service as any).buildReplyHtml('Bitte Ticket fertig machen', 'de');
    expect(body).toContain('<blockquote>Bitte Ticket fertig machen</blockquote>');
    expect(body).toContain('<p>Erledigt.</p>');
  });

  it('sends one reply and marks task notified', async () => {
    const { service, prismaService, graphService } = makeService();
    const now = new Date('2026-03-05T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    prismaService.task.findMany.mockResolvedValue([
      {
        id: 'db-1',
        chatId: 'chat-1',
        graphMessageId: 'msg-1',
        text: 'Finish report',
        sourceMessageText: 'Please finish the report',
        sourceLanguage: null,
        sourceType: 'AUTO_DETECTED',
        autoReplyEnabled: true,
        done: false,
        completedAt: null,
        completionNotifiedAt: null,
      },
    ]);
    prismaService.task.update.mockResolvedValue({});

    await service.pollAndNotifyCompletions();

    expect(graphService.sendReply).toHaveBeenCalledTimes(1);
    expect(graphService.sendReply).toHaveBeenCalledWith(
      'chat-1',
      'msg-1',
      expect.stringContaining('<p>Done.</p>'),
    );
    expect(prismaService.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'db-1' },
        data: expect.objectContaining({
          completionNotifiedAt: expect.any(Date),
        }),
      }),
    );
    jest.useRealTimers();
  });

  it('skips candidates missing linkage', async () => {
    const { service, prismaService, graphService } = makeService();
    prismaService.task.findMany.mockResolvedValue([
      {
        id: 'db-3',
        chatId: '',
        graphMessageId: '',
        text: 'x',
        sourceMessageText: 'x',
        sourceLanguage: 'en',
        sourceType: 'AUTO_DETECTED',
        autoReplyEnabled: true,
        completionNotifiedAt: null,
        done: true,
        completedAt: null,
      },
    ]);
    prismaService.task.update.mockResolvedValue({});

    await service.pollAndNotifyCompletions();

    expect(graphService.sendReply).not.toHaveBeenCalled();
    expect(prismaService.task.update).not.toHaveBeenCalled();
  });
});
