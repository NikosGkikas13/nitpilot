/** How the chat names a person's agent (handoff "Who did what"): "Your agent" for yours, "leo's agent" for theirs. */
export function agentName(login: string, yourLogin: string): string {
  return login === yourLogin ? 'Your agent' : `${login}'s agent`;
}

/** "You", or the person's GitHub login. */
export function personName(login: string, yourLogin: string): string {
  return login === yourLogin ? 'You' : login;
}
