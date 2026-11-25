import { Router } from 'express';
import { checkInput, runQuickChat, StoppedError } from '@app/agent';
import { quickChatRequestSchema, type QuickChatEvent } from '@app/shared';
import type { AppContext } from '../../context.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { ValidationError } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import type { ModelsService } from '../models/models.service.js';

/**
 * `POST /v1/quick-chat`: a chat with a model outside any workspace, with the web tools
 * (web_search, fetch_page) on. The browser sends the whole conversation each time and keeps it
 * only in memory; the server streams the reply and the tool calls as server-sent events
 * (`QuickChatEvent`) and saves nothing, so a closed chat is gone.
 */
export function quickChatRouter(
  { agentConfig, settings, agentLogger }: AppContext,
  models: ModelsService,
): Router {
  const router = Router();

  router.post(
    '/quick-chat',
    asyncHandler(async (req, res) => {
      const { messages, modelId, reasoningEffort, useWeb } = parse(
        quickChatRequestSchema,
        req.body,
      );
      const config = settings.configFor(agentConfig);
      // The schema makes sure there is one, and that it's the user's.
      const last = messages[messages.length - 1]?.content ?? '';
      const inputCheck = checkInput(last, config);
      if (!inputCheck.ok) throw new ValidationError(inputCheck.reason);
      // Checked before the stream starts, so a missing model is a normal JSON error.
      const { settings: model } = await models.forRun(modelId, reasoningEffort);

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const stop = new AbortController();
      let isOpen = true;
      res.on('close', () => {
        isOpen = false;
        stop.abort();
      });
      const send = (event: QuickChatEvent) => {
        if (isOpen) res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      try {
        const text = await runQuickChat({
          model,
          messages,
          searxngUrl: config.searxngUrl,
          onProgress: send,
          useWeb,
          signal: stop.signal,
        });
        send({ type: 'done', text });
      } catch (error) {
        if (!stop.signal.aborted && !(error instanceof StoppedError)) {
          const text = error instanceof Error ? error.message : String(error);
          agentLogger.error(`Quick chat failed: ${text}`);
          send({ type: 'error', message: text });
        }
      }
      res.end();
    }),
  );

  return router;
}
