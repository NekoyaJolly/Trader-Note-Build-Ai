import "dotenv/config";
import { google } from "googleapis";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";

const EnvSchema = z.object({
  GOOGLE_AI_API_KEY: z.string().min(1, "GOOGLE_AI_API_KEY は必須です"),
  GEMINI_MODEL: z.string().min(1).optional().default("gemini-1.5-pro"),
  GOOGLE_DRIVE_FOLDER_ID: z.string().min(1, "GOOGLE_DRIVE_FOLDER_ID は必須です"),
  GOOGLE_DRIVE_OAUTH_TOKEN_PATH: z
    .string()
    .min(1)
    .optional()
    .default("./.oauth-token.json"),
  GOOGLE_DRIVE_CREDENTIALS_PATH: z
    .string()
    .min(1)
    .optional()
    .default("./oauth-credentials.json"),
});

type EnvConfig = z.infer<typeof EnvSchema>;

const OAuthCredentialsSchema = z.object({
  installed: z
    .object({
      client_id: z.string(),
      client_secret: z.string(),
      redirect_uris: z.array(z.string()).optional(),
    })
    .optional(),
  web: z
    .object({
      client_id: z.string(),
      client_secret: z.string(),
      redirect_uris: z.array(z.string()).optional(),
    })
    .optional(),
});

type OAuthCredentials = z.infer<typeof OAuthCredentialsSchema>;

const OAuthTokenSchema = z.object({
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
  expiry_date: z.number().optional(),
});

type OAuthToken = z.infer<typeof OAuthTokenSchema>;

const DriveFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
});

type DriveFile = z.infer<typeof DriveFileSchema>;

const DriveFileListSchema = z.object({
  files: z.array(DriveFileSchema).optional(),
  nextPageToken: z.string().optional(),
});

type DriveFileList = z.infer<typeof DriveFileListSchema>;

type CachedFile = {
  id: string;
  name: string;
  content: string;
};

type CachedContext = {
  files: CachedFile[];
  lastSyncedAt: string;
};

const RefreshArgsSchema = z.object({}).strict();
const AnalyzeArgsSchema = z.object({
  query: z.string().min(1, "query は必須です"),
});

const SYSTEM_INSTRUCTIONS = [
  "あなたはコードベース理解の専門家です。",
  "与えられたドキュメントのみを根拠に回答してください。",
  "不明な点は推測せず、必要な追加情報を明確に伝えてください。",
].join("\n");

const loadEnv = (): EnvConfig => {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ 環境変数の読み込みに失敗しました", result.error.format());
    process.exit(1);
  }
  return result.data;
};

const loadOAuthCredentials = async (path: string): Promise<OAuthCredentials> => {
  const raw = await readFile(path, "utf-8");
  return OAuthCredentialsSchema.parse(JSON.parse(raw));
};

const loadOAuthToken = async (path: string): Promise<OAuthToken> => {
  const raw = await readFile(path, "utf-8");
  return OAuthTokenSchema.parse(JSON.parse(raw));
};

const createDriveClient = async (config: EnvConfig) => {
  const credentialsPath = resolve(config.GOOGLE_DRIVE_CREDENTIALS_PATH);
  const tokenPath = resolve(config.GOOGLE_DRIVE_OAUTH_TOKEN_PATH);

  const credentials = await loadOAuthCredentials(credentialsPath);
  const token = await loadOAuthToken(tokenPath);

  const clientInfo = credentials.installed ?? credentials.web;
  if (!clientInfo) {
    console.error("❌ OAuth クライアント情報が見つかりません");
    process.exit(1);
  }

  const auth = new google.auth.OAuth2(
    clientInfo.client_id,
    clientInfo.client_secret,
    clientInfo.redirect_uris?.[0]
  );

  auth.setCredentials(token);
  return google.drive({ version: "v3", auth });
};

const isMarkdownFile = (file: DriveFile): boolean => {
  const nameLower = file.name.toLowerCase();
  const mime = file.mimeType ?? "";

  return (
    nameLower.endsWith(".md") ||
    mime === "text/markdown" ||
    mime === "text/plain" ||
    mime.startsWith("text/")
  );
};

const streamToString = async (stream: Readable): Promise<string> => {
  // ストリームを文字列へ変換することで、Markdown本文を安全に取得する
  return await new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];

    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    stream.on("end", () => {
      resolvePromise(Buffer.concat(chunks).toString("utf-8"));
    });

    stream.on("error", (error: Error) => {
      rejectPromise(error);
    });
  });
};

const downloadFileContent = async (
  drive: ReturnType<typeof google.drive>,
  file: DriveFile
): Promise<string> => {
  if (file.mimeType?.startsWith("application/vnd.google-apps.")) {
    const exportRes = await drive.files.export(
      {
        fileId: file.id,
        mimeType: "text/plain",
      },
      { responseType: "stream" }
    );
    return await streamToString(exportRes.data);
  }

  const res = await drive.files.get(
    { fileId: file.id, alt: "media" },
    { responseType: "stream" }
  );

  return await streamToString(res.data);
};

const fetchDriveFiles = async (
  drive: ReturnType<typeof google.drive>,
  folderId: string
): Promise<CachedFile[]> => {
  const collected: DriveFile[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType)",
      pageToken,
    });

    const parsed: DriveFileList = DriveFileListSchema.parse(res.data);
    const files = parsed.files ?? [];
    collected.push(...files);
    pageToken = parsed.nextPageToken ?? undefined;
  } while (pageToken);

  const targets = collected.filter(isMarkdownFile);
  const contents: CachedFile[] = [];

  for (const file of targets) {
    const content = await downloadFileContent(drive, file);
    contents.push({ id: file.id, name: file.name, content });
  }

  return contents;
};

const buildPrompt = (context: CachedContext, query: string): string => {
  const header = `# システム指示\n${SYSTEM_INSTRUCTIONS}`;
  const filesBlock = context.files
    .map((file) => {
      return [
        `\n# ファイル: ${file.name}`,
        file.content,
      ].join("\n");
    })
    .join("\n\n");

  return [header, "\n# コンテキスト", filesBlock, `\n# 質問\n${query}`].join(
    "\n\n"
  );
};

const createServer = async () => {
  const config = loadEnv();
  const drive = await createDriveClient(config);
  const genAi = new GoogleGenerativeAI(config.GOOGLE_AI_API_KEY);

  let cachedContext: CachedContext | null = null;

  const refreshContext = async (): Promise<CachedContext> => {
    const files = await fetchDriveFiles(drive, config.GOOGLE_DRIVE_FOLDER_ID);
    cachedContext = {
      files,
      lastSyncedAt: new Date().toISOString(),
    };
    return cachedContext;
  };

  const ensureContext = async (): Promise<CachedContext> => {
    if (!cachedContext) {
      return refreshContext();
    }
    return cachedContext;
  };

  const server = new Server(
    {
      name: "gemini-drive-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "refresh_context",
          description:
            "Google Driveから最新のMarkdownファイルを再読み込みします。",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        {
          name: "get_status",
          description: "コンテキストの同期状況を返します。",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        {
          name: "analyze_codebase",
          description:
            "読み込んだコンテキストを元にコードベースの質問へ回答します。",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "コードベースに関する質問",
              },
            },
            required: ["query"],
            additionalProperties: false,
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const toolName = request.params.name;

    if (toolName === "refresh_context") {
      RefreshArgsSchema.parse(request.params.arguments ?? {});
      const context = await refreshContext();
      const fileNames = context.files.map((file) => file.name);

      return {
        content: [
          {
            type: "text",
            text: `Successfully loaded ${fileNames.length} files: ${fileNames.join(
              ", "
            )}`,
          },
        ],
      };
    }

    if (toolName === "get_status") {
      RefreshArgsSchema.parse(request.params.arguments ?? {});
      const status = cachedContext
        ? {
            lastSyncedAt: cachedContext.lastSyncedAt,
            files: cachedContext.files.map((file) => file.name),
          }
        : {
            lastSyncedAt: "未同期",
            files: [],
          };

      const message = [
        `lastSyncedAt: ${status.lastSyncedAt}`,
        `files: ${status.files.join(", ") || "(none)"}`,
        `model: ${config.GEMINI_MODEL}`,
      ].join("\n");

      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
      };
    }

    if (toolName === "analyze_codebase") {
      const args = AnalyzeArgsSchema.parse(request.params.arguments ?? {});
      const context = await ensureContext();

      if (context.files.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "コンテキストが空です。Google Driveのフォルダを確認してください。",
            },
          ],
        };
      }

      const prompt = buildPrompt(context, args.query);

      try {
        const model = genAi.getGenerativeModel({ model: config.GEMINI_MODEL });
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("❌ Gemini API 呼び出しに失敗しました", error);
        return {
          content: [
            {
              type: "text",
              text:
                "Gemini API の呼び出しに失敗しました。時間を置いて再試行してください。",
            },
          ],
        };
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `未対応のツールです: ${toolName}`,
        },
      ],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("✅ Gemini-Drive MCP サーバーが起動しました");
};

createServer().catch((error) => {
  console.error("❌ サーバー起動に失敗しました", error);
  process.exit(1);
});
