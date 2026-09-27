// #4091: a Responses request whose input contains a function_call_output (or
// custom_tool_call_output) without call_id used to emit a Chat Completions
// tool message with tool_call_id: undefined — JSON.stringify drops the key,
// so every strict upstream (NVIDIA NIM, OpenCode, Cloudflare AI…) 400s the
// whole request and the combo burns all of its models. Outputs are now paired
// with their pending call by order; stray outputs are dropped; chat-style
// {role:"tool"} items without an id are salvaged as a user note.
import { describe, expect, it } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { convertResponsesApiFormat } from "../../open-sse/translator/formats/responsesApi.js";
import { ensureToolCallIds } from "../../open-sse/translator/concerns/toolCall.js";

const body = (input) => ({ model: "nvidia/z-ai/glm-5.3", input, stream: false });

describe("missing tool call_id repair (#4091)", () => {
  it("pairs an output without call_id with the preceding function_call", () => {
    const out = openaiResponsesToOpenAIRequest("z-ai/glm-5.3", body([
      { type: "message", role: "user", content: [{ type: "input_text", text: "rode a tool" }] },
      { type: "function_call", name: "exec_command", arguments: '{"cmd":"ls"}', call_id: "call_1" },
      { type: "function_call_output", output: "ok" },
    ]));

    const toolMsg = out.messages.find((m) => m.role === "tool");
    expect(toolMsg.tool_call_id).toBe("call_1");
    expect(JSON.stringify(out.messages)).toContain('"tool_call_id"');
  });

  it("drops a stray output that has no call at all", () => {
    const out = openaiResponsesToOpenAIRequest("z-ai/glm-5.3", body([
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "function_call_output", output: "orphan" },
    ]));

    expect(out.messages.filter((m) => m.role === "tool")).toEqual([]);
    expect(JSON.stringify(out.messages)).not.toContain("orphan");
  });

  it("gives a call that lost its own call_id a deterministic id and pairs the output", () => {
    const out = openaiResponsesToOpenAIRequest("z-ai/glm-5.3", body([
      { type: "function_call", name: "exec_command", arguments: "{}" },
      { type: "function_call_output", output: "done" },
    ]));

    const assistant = out.messages.find((m) => m.role === "assistant");
    const generatedId = assistant.tool_calls[0].id;
    expect(generatedId).toMatch(/^call_auto_\d+$/);
    const toolMsg = out.messages.find((m) => m.role === "tool");
    expect(toolMsg.tool_call_id).toBe(generatedId);
  });

  it("keeps parallel-call order when several outputs lose their ids", () => {
    const out = openaiResponsesToOpenAIRequest("z-ai/glm-5.3", body([
      { type: "function_call", name: "a", arguments: "{}", call_id: "call_A" },
      { type: "function_call", name: "b", arguments: "{}", call_id: "call_B" },
      { type: "function_call_output", output: "first" },
      { type: "function_call_output", output: "second" },
    ]));

    const toolMsgs = out.messages.filter((m) => m.role === "tool");
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(["call_A", "call_B"]);
    expect(toolMsgs[0].content).toBe("first");
    expect(toolMsgs[1].content).toBe("second");
  });

  it("salvages a chat-style tool item without an id as a user note", () => {
    const out = openaiResponsesToOpenAIRequest("z-ai/glm-5.3", body([
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { role: "tool", content: [{ type: "input_text", text: "tool payload" }] },
    ]));

    expect(out.messages.filter((m) => m.role === "tool")).toEqual([]);
    const salvaged = out.messages.at(-1);
    expect(salvaged.role).toBe("user");
    expect(JSON.stringify(salvaged)).toContain("[Tool result]");
    expect(JSON.stringify(salvaged)).toContain("tool payload");
  });

  it("keeps a chat-style tool item that names its call", () => {
    const out = openaiResponsesToOpenAIRequest("z-ai/glm-5.3", body([
      { type: "function_call", name: "exec_command", arguments: "{}", call_id: "call_9" },
      { role: "tool", call_id: "call_9", content: [{ type: "input_text", text: "ok" }] },
    ]));

    const toolMsg = out.messages.filter((m) => m.role === "tool").at(-1);
    expect(toolMsg.tool_call_id).toBe("call_9");
  });

  it("does not regress the duplicate converter in formats/responsesApi.js", () => {
    const out = convertResponsesApiFormat(body([
      { type: "function_call", name: "exec_command", arguments: "{}", call_id: "call_1" },
      { type: "function_call_output", output: "ok" },
    ]));
    const toolMsg = out.messages.find((m) => m.role === "tool");
    expect(toolMsg.tool_call_id).toBe("call_1");

    const stray = convertResponsesApiFormat(body([
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "function_call_output", output: "orphan" },
    ]));
    expect(stray.messages.filter((m) => m.role === "tool")).toEqual([]);
  });
});

describe("ensureToolCallIds repairs absent tool_call_id (#4091)", () => {
  it("pairs a chat tool message missing tool_call_id with the preceding assistant call", () => {
    const repaired = ensureToolCallIds({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "ls", arguments: "{}" } }] },
        { role: "tool", content: "ok" },
      ],
    });
    expect(repaired.messages[2].tool_call_id).toBe("call_1");
  });

  it("generates an id for an orphan tool message", () => {
    const repaired = ensureToolCallIds({
      messages: [
        { role: "user", content: "hi" },
        { role: "tool", content: "stray" },
      ],
    });
    expect(repaired.messages[1].tool_call_id).toMatch(/^call_msg1_tc0$/);
  });
});
