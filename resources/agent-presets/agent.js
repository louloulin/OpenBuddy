export default {
  apply(context, config) {
    const sections = Array.isArray(config?.sections) ? config.sections : [];
    if (!sections.length) return undefined;
    const systemPrompt = context.get("systemPrompt");
    if (!systemPrompt?.section) throw new Error("clinical preset requires systemPrompt service");
    const disposers = sections
      .filter((section) => section?.name && typeof section.text === "string")
      .map((section) => systemPrompt.section(section));
    return () => disposers.forEach((dispose) => dispose());
  },
};
