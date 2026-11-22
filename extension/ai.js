// ai.js - Handles the AI agent logic and API calls (OpenRouter Only)

// Define the tool so the AI knows what it can do
const aiTools = [
  {
    type: "function",
    function: {
      name: "fetch_professor_reviews",
      description: "Fetches recent student reviews for a specific professor. Use this to answer questions about teaching style, exams, and homework.",
      parameters: {
        type: "object",
        properties: {
          professorId: {
            type: "string",
            description: "The RateMyProfessors ID of the professor."
          }
        },
        required: ["professorId"]
      }
    }
  }
];

// The main agent loop
async function runAIAgent(professor, userQuestion) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  
  if (!apiKey) return "Please set your OpenRouter API key in the extension settings.";
  if (!apiKey.startsWith("sk-or-")) return "Invalid key. Please enter a valid OpenRouter key (starts with sk-or-).";

  const apiUrl = "https://openrouter.ai/api/v1/chat/completions";
  const modelName = "google/gemini-2.5-flash"; 

  const messages = [
    {
      role: "system",
      content: "You are a helpful academic advisor. Answer the user's question using ONLY the information provided by the tools. If the reviews don't mention the topic, say 'The reviews don't mention that.'"
    },
    {
      role: "user",
      content: `Professor ID is ${professor.id}. Question: ${userQuestion}`
    }
  ];

  const MAX_TURNS = 3; 

  for (let i = 0; i < MAX_TURNS; i++) {
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: modelName,
          messages: messages,
          tools: aiTools,
          max_tokens: 1000
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `API Request Failed with status ${response.status}`);
      }

      const data = await response.json();
      const aiMessage = data.choices[0].message;

      // Check if the AI wants to call our tool
      if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
        const toolCall = aiMessage.tool_calls[0]; 

        if (toolCall.function.name === "fetch_professor_reviews") {
          const args = JSON.parse(toolCall.function.arguments);
          
          // Send a message to background.js to fetch the reviews!
          const reviews = await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { action: "FETCH_RMP_REVIEWS", professorId: args.professorId },
              (response) => {
                if (response && response.success) {
                  resolve(response.reviews);
                } else {
                  resolve(["Failed to fetch reviews from background script."]);
                }
              }
            ) else {
          // If the AI hallucinates a tool, tell it the tool doesn't exist
          messages.push(aiMessage);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: "Error: Tool does not exist. You can only use fetch_professor_reviews."
          });
        };
          });

          // Add the AI's request and the tool's response to history
          messages.push(aiMessage); 
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: JSON.stringify(reviews)
          });
        }
      } else {
        // No tool calls, so this is the final answer
        return aiMessage.content;
      }
    } catch (error) {
      console.error("AI Agent Error:", error);
      return `Error: ${error.message}`;
    }
  }
  return "I couldn't figure out the answer within the time limit.";
}