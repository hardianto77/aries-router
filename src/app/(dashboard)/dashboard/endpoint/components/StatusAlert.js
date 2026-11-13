"use client";

/** Reusable status alert */
export default function StatusAlert({ status, className = "" }) {
  const renderMessage = (msg) => {
    const parts = msg.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, i) =>
      /^https?:\/\//.test(part)
        ? <a key={i} href={part} target="_blank" rel="noreferrer" className="underline font-medium">{part}</a>
        : part
    );
  };

  return (
    <div className={`p-2 rounded text-sm ${className} ${status.type === "success" ? "bg-success/10 text-success dark:text-success" :
        status.type === "warning" ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" :
        status.type === "info" ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" :
          "bg-danger/10 text-danger dark:text-danger"
      }`}>
      {renderMessage(status.message)}
    </div>
  );
}
