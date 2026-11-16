import { ListTodo } from "lucide-react";
import { defineWidget, lazyPart } from "../../../core/widget";
import { TodosTile } from "./TodosTile";

export default defineWidget({
  id: "productivity.todos",
  name: "Todos",
  category: "Productivity",
  description: "Next open task and a ring of today's progress; tick off from the tile.",
  keywords: ["to do", "to-do", "tasks", "checklist", "reminders", "alt+t"],
  icon: ListTodo,
  size: "l",
  multiple: false,
  Tile: TodosTile,
  Card: lazyPart(() => import("./TodosCard").then((m) => m.TodosCard)),
  cardSize: { width: 360, height: 520 },
});
