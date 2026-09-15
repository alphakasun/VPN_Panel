# MeshRoute VPN Panel

Базовая self-hosted панель для управления VPN-узлами и клиентскими
подключениями. Поддерживаются VLESS + Reality, Hysteria 2 и AmneziaWG.
Панель хранит desired state, выдаёт агенту конфигурацию и генерирует
подключения клиентов. Сам агент должен применить конфигурацию к Xray,
Hysteria или AmneziaWG на сервере.

## Возможности

- CRUD-минимум: создание узлов и клиентов в PostgreSQL.
- Генерация URI для VLESS Reality, Hysteria 2 и AmneziaWG.
- Agent pull API: узел забирает только свою конфигурацию по одноразово
  показанному `agentToken`; после применения сообщает readiness.
- Отправка готового подключения в Telegram Bot API.
- Административный API защищён `Authorization: Bearer $PANEL_API_KEY`.

## Запуск

Требуются Node.js 20+ и PostgreSQL 15+.

```bash
export PANEL_API_KEY='long-random-admin-secret'
export DATABASE_URL='postgresql://meshroute:password@127.0.0.1:5432/meshroute'
# optional: delivery of client configuration messages
export TELEGRAM_BOT_TOKEN='123456:bot-token'
npm test && npm start
# открыть http://localhost:3000
```

При запуске панель автоматически применяет миграцию. PostgreSQL хранит
контрольное состояние (`nodes`, `clients`, `routingPolicies`) в транзакционном
`JSONB`-документе и отдельный неизменяемый журнал `audit_events`. Строка
состояния блокируется `FOR UPDATE`, поэтому одновременные операции панели и
agent не перезаписывают данные друг друга.

## API

Все административные `/api/*` требуют admin Bearer token. Agent config и
agent readiness проверяют отдельный токен узла.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Проверка работы процесса. |
| `GET` | `/api/state` | Узлы и клиенты для панели. |
| `POST` | `/api/nodes` | Создать узел; ответ содержит `agentToken` **только один раз**. |
| `POST` | `/api/clients` | Создать клиента с `name` и `nodeId`. |
| `GET` | `/api/clients/:id/connection` | Получить клиентский URI. |
| `POST` | `/api/clients/:id/telegram` | Тело `{ "chatId": "…" }`; отправить URI ботом. |
| `GET` | `/api/agent/nodes/:id/config` | Agent Bearer token; desired server config. |
| `POST` | `/api/nodes/:id/ready` | Agent сообщает `{ "agentToken": "…" }` после применения. |

### Пример регистрации VLESS Reality узла

Reality key pair создаётся Xray на стороне агента/сервера; панель принимает
его публичную часть и short ID, но не генерирует приватный ключ.

```bash
curl -X POST http://localhost:3000/api/nodes \
  -H "Authorization: Bearer $PANEL_API_KEY" -H 'content-type: application/json' \
  -d '{"name":"DE-1","host":"vpn.example.com","port":443,"protocol":"vless-reality","sni":"www.microsoft.com","realityPublicKey":"PUBLIC_KEY","realityShortId":"a1b2c3d4"}'
```

## Production blueprint

1. Разделите controller и node-agent: controller хранит желаемое состояние,
   agent применяет подписанную конфигурацию WireGuard/Xray/Hysteria и возвращает статус.
2. Используйте mTLS, короткоживущие сертификаты, RBAC и неизменяемый audit log.
   Не публикуйте agent API в интернет без аутентификации.
3. Разворачивайте full-mesh или ограниченную topology через WireGuard; для
   межузловых префиксов применяйте BGP/OSPF либо контролируемые статические
   routes. Dataplane должен иметь kill-switch и антиспуфинг.
4. Переключайте маршрут по двухфазной схеме: health-check нового пути,
   атомарное применение на агенте, подтверждение, затем drain старого пути.
5. Храните секреты в Vault/KMS, а метрики и логи — в отдельном контуре.
