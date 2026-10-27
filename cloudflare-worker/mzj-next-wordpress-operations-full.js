/**

 * MZJ NEXT ERP -> WordPress Car Sync

 * Cloudflare Worker

 *

 * NEXT:

 * https://mzj2.newworldinfosys.com

 *

 * WordPress:

 * https://mzjcars.com

 *

 * WordPress Endpoint:

 * /wp-json/mzj-next/v1/sync-car

 */



const DEFAULT_NEXT_BASE_URL = "https://mzj2.newworldinfosys.com";

const DEFAULT_WP_BASE_URL = "https://mzjcars.com";



const WP_SYNC_PATH = "/wp-json/mzj-next/v1/sync-car";



const NEXT_PAGE_SIZE = 500;

const CONCURRENCY = 5;



export default {

  async fetch(request, env, ctx) {

    try {

      const url = new URL(request.url);



      /**

       * ============================================================

       * HEALTH

       * ============================================================

       */

      if (

        request.method === "GET" &&

        (url.pathname === "/" || url.pathname === "/health")

      ) {

        return jsonResponse({

          ok: true,

          service: "mzj-next-stock-worker",

          version: "1.2.0",



          next_base_url: nextBaseUrl(env),

          wp_base_url: wpBaseUrl(env),



          configured: {

            next_api_key: Boolean(env.NEXT_API_KEY),

            next_api_secret: Boolean(env.NEXT_API_SECRET),



            wp_username: Boolean(env.WP_USERNAME),

            wp_app_password: Boolean(env.WP_APP_PASSWORD),



            frappe_webhook_secret: Boolean(env.FRAPPE_WEBHOOK_SECRET),

            worker_admin_token: Boolean(env.WORKER_ADMIN_TOKEN),
            mzj_stock_database: Boolean(env.MZJ_STOCK_DB),
            mzj_stock_queue: Boolean(env.MZJ_STOCK_QUEUE),
            mzj_stock_sync_key: Boolean(env.MZJ_STOCK_SYNC_KEY),
            mzj_platform_url: Boolean(env.MZJ_PLATFORM_URL),

          },

        });

      }



      // Operations-only preview / manual sync: never calls the WordPress path.
      if (request.method === 'POST' &&
          (url.pathname === '/operations/preview' || url.pathname === '/operations/manual')) {
        return await opsManualRequest(request, env, ctx, url.pathname);
      }

      /**

       * ============================================================

       * MANUAL TEST

       * ============================================================

       *

       * POST /manual

       *

       * Authorization:

       * Bearer WORKER_ADMIN_TOKEN

       *

       * Body:

       * {

       *   "receipt": "MAT-PRE-2026-00105",

       *   "event": "manual_test"

       * }

       */

      if (

        request.method === "POST" &&

        url.pathname === "/manual"

      ) {

        validateCoreConfig(env);



        if (!env.WORKER_ADMIN_TOKEN) {

          return jsonResponse(

            {

              ok: false,

              error: "WORKER_ADMIN_TOKEN is not configured.",

            },

            500

          );

        }



        const auth =

          request.headers.get("Authorization") || "";



        if (

          auth !==

          `Bearer ${env.WORKER_ADMIN_TOKEN}`

        ) {

          return jsonResponse(

            {

              ok: false,

              error: "Unauthorized.",

            },

            401

          );

        }



        const body =

          await readJson(request);



        const receipt = clean(

          body?.receipt ||

          body?.name

        );



        const event = clean(

          body?.event ||

          "manual"

        );



        if (!receipt) {

          return jsonResponse(

            {

              ok: false,

              error: "Missing receipt.",

            },

            400

          );

        }



        const result =

          await processPurchaseReceipt(

            receipt,

            event,

            env

          );



        return jsonResponse({

          ok: true,

          result,

        });

      }



      /**

       * ============================================================

       * NEXT ERP WEBHOOK

       * ============================================================

       *

       * POST /webhook

       */

      if (

        request.method === "POST" &&

        (

          url.pathname === "/" ||

          url.pathname === "/webhook"

        )

      ) {

        validateCoreConfig(env);



        if (!env.FRAPPE_WEBHOOK_SECRET) {

          return jsonResponse(

            {

              ok: false,

              error:

                "FRAPPE_WEBHOOK_SECRET is not configured.",

            },

            500

          );

        }



        /**

         * مهم:

         * نقرأ الـBody مرة واحدة فقط.

         */

        const rawBody =

          await request.text();



        /**

         * Frappe standard signature.

         */

        const frappeSignature =

          request.headers.get(

            "X-Frappe-Webhook-Signature"

          ) || "";



        /**

         * Backup shared-secret header.

         *

         * هنستخدمه فقط لو احتجناه في NEXT.

         *

         * Header:

         * X-MZJ-Webhook-Secret

         */

        const mzjSecretHeader =

          request.headers.get(

            "X-MZJ-Webhook-Secret"

          ) || "";



        /**

         * لازم يبقى فيه واحدة على الأقل من طريقتين الحماية.

         */

        if (

          !frappeSignature &&

          !mzjSecretHeader

        ) {

          return jsonResponse(

            {

              ok: false,

              error:

                "Missing webhook authentication.",

            },

            401

          );

        }



        /**

         * ============================================================

         * VERIFY SECURITY

         * ============================================================

         */



        let authenticated = false;

        let authMethod = null;



        /**

         * 1) Standard Frappe HMAC verification

         */

        if (frappeSignature) {

          const signatureOk =

            await verifyFrappeWebhookSignature(

              rawBody,

              frappeSignature,

              env.FRAPPE_WEBHOOK_SECRET

            );



          if (signatureOk) {

            authenticated = true;

            authMethod = "frappe_hmac";

          }

        }



        /**

         * 2) Backup MZJ shared-secret header

         *

         * ده مش نفس X-Frappe-Webhook-Signature.

         * ده Header منفصل تمامًا.

         */

        if (

          !authenticated &&

          mzjSecretHeader

        ) {

          const secretOk =

            await secureStringEqual(

              mzjSecretHeader,

              env.FRAPPE_WEBHOOK_SECRET

            );



          if (secretOk) {

            authenticated = true;

            authMethod = "mzj_shared_secret";

          }

        }



        if (!authenticated) {

          return jsonResponse(

            {

              ok: false,

              error:

                "Invalid webhook authentication.",

            },

            401

          );

        }



        /**

         * ============================================================

         * PARSE BODY

         * ============================================================

         */



        let body;



        try {

          body =

            rawBody

              ? JSON.parse(rawBody)

              : {};

        } catch {

          return jsonResponse(

            {

              ok: false,

              error:

                "Webhook body is not valid JSON.",

            },

            400

          );

        }



        const receipt = clean(

          body?.receipt ||

          body?.name ||

          body?.id

        );



        const event = clean(

          body?.event ||

          "webhook"

        );



        if (!receipt) {

          return jsonResponse(

            {

              ok: false,

              error:

                "Missing receipt in webhook body.",

            },

            400

          );

        }



        /**

         * ============================================================

         * BACKGROUND SYNC

         * ============================================================

         *

         * نرجع لـNEXT بسرعة 202

         * والمزامنة تكمل Background.

         */



        ctx.waitUntil(

          processPurchaseReceipt(

            receipt,

            event,

            env

          )

            .then((result) => {

              console.log(

                JSON.stringify({

                  level: "info",



                  message:

                    "NEXT -> WordPress sync completed",



                  auth_method:

                    authMethod,



                  result,

                })

              );

            })

            .catch((error) => {

              console.error(

                JSON.stringify({

                  level: "error",



                  message:

                    "NEXT -> WordPress sync failed",



                  receipt,

                  event,



                  error:

                    serializeError(error),

                })

              );

            })

        );



        // Independent durable Operations outbox; failures cannot stop WordPress.
        if (event === 'on_submit' && env.MZJ_STOCK_DB &&
            env.MZJ_PLATFORM_URL && env.MZJ_STOCK_SYNC_KEY) {
          ctx.waitUntil(
            opsEnqueueReceipt(env, receipt, event)
              .catch((error) => console.error('NEXT -> MZJ Operations enqueue failed', {
                receipt, error: serializeError(error),
              }))
          );
        } else if (event === 'on_submit') {
          console.error('NEXT -> MZJ Operations stock not configured; WordPress sync continues', { receipt });
        }

        return jsonResponse(

          {

            ok: true,

            queued: true,



            receipt,

            event,



            auth_method:

              authMethod,

          },

          202

        );

      }



      return jsonResponse(

        {

          ok: false,

          error: "Not found.",

        },

        404

      );

    } catch (error) {

      console.error(error);



      return jsonResponse(

        {

          ok: false,



          error:

            error?.message ||

            "Unexpected Worker error.",

        },

        500

      );

    }

  },

  // Scheduled recovery: pending D1 jobs stay retryable after Queue exhaustion.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(opsDrainDueReceipts(env, 10).catch((error) =>
      console.error('MZJ Operations durable retry tick failed', serializeError(error))
    ));
  },

  // Optional Cloudflare Queues consumer: fast 5s/15s retries.
  async queue(batch, env) {
    for (const message of batch.messages) {
      const receipt = clean(message.body?.receipt);
      if (!receipt) {
        message.ack();
        continue;
      }
      try {
        const result = await opsProcessPendingReceipt(env, receipt);
        if (result.ok && (result.claimed || result.state === 'delivered')) {
          message.ack();
        } else if (!result.ok || result.state === 'pending') {
          message.retry({ delaySeconds: Math.max(1, Number(result.retryAfter || 60)) });
        } else {
          message.ack();
        }
      } catch (error) {
        console.error('MZJ Operations Queue delivery failed', { receipt, error: serializeError(error) });
        message.retry({ delaySeconds: 60 });
      }
    }
  },

};





/**

 * ============================================================

 * PROCESS PURCHASE RECEIPT

 * ============================================================

 */



async function processPurchaseReceipt(

  receiptName,

  event,

  env

) {

  const startedAt =

    new Date().toISOString();



  /**

   * Get Purchase Receipt from NEXT.

   */

  const receipt =

    await frappeGetDocument(

      env,

      "Purchase Receipt",

      receiptName

    );



  const items =

    Array.isArray(receipt?.items)

      ? receipt.items

      : [];



  /**

   * Get unique Item Codes from Purchase Receipt.

   */

  const itemCodes =

    unique(

      items

        .map((row) =>

          clean(row?.item_code)

        )

        .filter(Boolean)

    );



  if (itemCodes.length === 0) {

    return {

      receipt:

        receiptName,



      event,



      started_at:

        startedAt,



      finished_at:

        new Date().toISOString(),



      item_codes: [],



      groups: [],



      warnings: [

        "Purchase Receipt contains no Item Codes.",

      ],

    };

  }



  /**

   * ============================================================

   * RESOLVE ITEM CODE -> CAR IDENTITY

   * ============================================================

   */



  const identityResults =

    await mapLimit(

      itemCodes,

      CONCURRENCY,



      async (itemCode) => {

        const rows =

          await frappeGetList(

            env,

            {

              doctype:

                "Serial No",



              fields: [

                "name",

                "item_code",

                "item_group",

                "type",

                "class",

                "model",

              ],



              filters: [

                [

                  "item_code",

                  "=",

                  itemCode,

                ],

              ],



              limit_start: 0,



              limit_page_length: 1,



              order_by:

                "modified desc",

            }

          );



        if (!rows.length) {

          return {

            item_code:

              itemCode,



            identity:

              null,



            warning:

              `No Serial No record found for Item Code ${itemCode}.`,

          };

        }



        const identity =

          rowToIdentity(

            rows[0]

          );



        if (

          !isCompleteIdentity(

            identity

          )

        ) {

          return {

            item_code:

              itemCode,



            identity:

              null,



            warning:

              `Incomplete NEXT identity for Item Code ${itemCode}.`,

          };

        }



        return {

          item_code:

            itemCode,



          identity,



          warning:

            null,

        };

      }

    );



  const warnings =

    identityResults

      .map(

        (result) =>

          result.warning

      )

      .filter(Boolean);



  /**

   * ============================================================

   * REMOVE DUPLICATE IDENTITIES

   * ============================================================

   */



  const identityMap =

    new Map();



  for (

    const result

    of identityResults

  ) {

    if (!result.identity) {

      continue;

    }



    const key =

      identityKey(

        result.identity

      );



    if (

      !identityMap.has(key)

    ) {

      identityMap.set(

        key,

        result.identity

      );

    }

  }



  const identities =

    [

      ...identityMap.values(),

    ];



  /**

   * ============================================================

   * GET CURRENT AVAILABLE STOCK FROM NEXT

   * ============================================================

   */



  const currentGroups =

    await mapLimit(

      identities,

      CONCURRENCY,



      async (identity) => {

        const rows =

          await getAllAvailableSerialsForIdentity(

            env,

            identity

          );



        /**

         * Available Interior Colors

         */

        const interiorColors =

          unique(

            rows

              .map(

                (row) =>

                  clean(

                    row?.custom_color

                  )

              )

              .filter(Boolean)

          );



        /**

         * Available Exterior Colors

         */

        const exteriorColors =

          unique(

            rows

              .map(

                (row) =>

                  clean(

                    row?.custom_external_color

                  )

              )

              .filter(Boolean)

          );



        return {

          ...identity,



          available_count:

            rows.length,



          interior_colors:

            interiorColors,



          exterior_colors:

            exteriorColors,

        };

      }

    );



  /**

   * ============================================================

   * SEND TO WORDPRESS

   * ============================================================

   */



  const wpResults =

    await mapLimit(

      currentGroups,

      CONCURRENCY,



      async (group) => {

        const payload = {

          make:

            group.make,



          model:

            group.model,



          trim:

            group.trim,



          year:

            group.year,



          interior_colors:

            group.interior_colors,



          exterior_colors:

            group.exterior_colors,

        };



        const wp =

          await wordpressSyncCar(

            env,

            payload

          );



        return {

          identity: {

            make:

              group.make,



            model:

              group.model,



            trim:

              group.trim,



            year:

              group.year,

          },



          available_count:

            group.available_count,



          interior_colors:

            group.interior_colors,



          exterior_colors:

            group.exterior_colors,



          wordpress:

            wp,

        };

      }

    );



  return {

    receipt:

      receiptName,



    event,



    started_at:

      startedAt,



    finished_at:

      new Date().toISOString(),



    item_codes:

      itemCodes,



    identity_count:

      identities.length,



    groups:

      wpResults,



    warnings,

  };

}





/**

 * ============================================================

 * GET ALL AVAILABLE SERIALS FOR A CAR IDENTITY

 * ============================================================

 */



async function getAllAvailableSerialsForIdentity(

  env,

  identity

) {

  const all = [];



  let offset = 0;



  while (true) {

    const page =

      await frappeGetList(

        env,

        {

          doctype:

            "Serial No",



          fields: [

            "name",



            "item_code",



            "item_group",



            "type",



            "class",



            "model",



            "custom_color",



            "custom_external_color",



            "warehouse",



            "car_status",



            "status",

          ],



          filters: [

            [

              "item_group",

              "=",

              identity.make,

            ],



            [

              "type",

              "=",

              identity.model,

            ],



            [

              "class",

              "=",

              identity.trim,

            ],



            [

              "model",

              "=",

              identity.year,

            ],



            [

              "car_status",

              "=",

              "متاحة للحجز",

            ],



            [

              "status",

              "=",

              "Active",

            ],



            [

              "warehouse",

              "!=",

              "",

            ],

          ],



          limit_start:

            offset,



          limit_page_length:

            NEXT_PAGE_SIZE,



          order_by:

            "name asc",

        }

      );



    all.push(

      ...page

    );



    if (

      page.length <

      NEXT_PAGE_SIZE

    ) {

      break;

    }



    offset +=

      page.length;

  }



  return all;

}





/**

 * ============================================================

 * NEXT GET DOCUMENT

 * ============================================================

 */



async function frappeGetDocument(

  env,

  doctype,

  name

) {

  const url =

    `${nextBaseUrl(env)}/api/resource/` +

    `${encodeURIComponent(doctype)}/` +

    `${encodeURIComponent(name)}`;



  const response =

    await fetch(

      url,

      {

        method:

          "GET",



        headers:

          nextHeaders(env),

      }

    );



  const data =

    await parseResponse(

      response

    );



  if (!response.ok) {

    throw new Error(

      `NEXT get ${doctype}/${name} failed (${response.status}): ${stringifyForError(data)}`

    );

  }



  return (

    data?.data ||

    null

  );

}





/**

 * ============================================================

 * NEXT GET LIST

 * ============================================================

 */



async function frappeGetList(

  env,

  args

) {

  const url =

    `${nextBaseUrl(env)}/api/method/frappe.client.get_list`;



  const response =

    await fetch(

      url,

      {

        method:

          "POST",



        headers: {

          ...nextHeaders(env),



          "Content-Type":

            "application/json",

        },



        body:

          JSON.stringify(args),

      }

    );



  const data =

    await parseResponse(

      response

    );



  if (!response.ok) {

    throw new Error(

      `NEXT frappe.client.get_list failed (${response.status}): ${stringifyForError(data)}`

    );

  }



  return Array.isArray(

    data?.message

  )

    ? data.message

    : [];

}





/**

 * ============================================================

 * WORDPRESS SYNC

 * ============================================================

 */



async function wordpressSyncCar(

  env,

  payload

) {

  const url =

    `${wpBaseUrl(env)}${WP_SYNC_PATH}`;



  const token =

    btoa(

      `${env.WP_USERNAME}:${env.WP_APP_PASSWORD}`

    );



  const response =

    await fetch(

      url,

      {

        method:

          "POST",



        headers: {

          Authorization:

            `Basic ${token}`,



          "Content-Type":

            "application/json",



          Accept:

            "application/json",

        },



        body:

          JSON.stringify(

            payload

          ),

      }

    );



  const data =

    await parseResponse(

      response

    );



  if (!response.ok) {

    throw new Error(

      `WordPress sync failed (${response.status}): ${stringifyForError(data)}`

    );

  }



  return data;

}





/**

 * ============================================================

 * NEXT HEADERS

 * ============================================================

 */



function nextHeaders(env) {

  return {

    Authorization:

      `token ${env.NEXT_API_KEY}:${env.NEXT_API_SECRET}`,



    Accept:

      "application/json",

  };

}





/**

 * ============================================================

 * NEXT BASE URL

 * ============================================================

 */



function nextBaseUrl(env) {

  return stripTrailingSlash(

    env.NEXT_BASE_URL ||

    DEFAULT_NEXT_BASE_URL

  );

}





/**

 * ============================================================

 * WORDPRESS BASE URL

 * ============================================================

 */



function wpBaseUrl(env) {

  return stripTrailingSlash(

    env.WP_BASE_URL ||

    DEFAULT_WP_BASE_URL

  );

}





/**

 * ============================================================

 * NEXT ROW -> CAR IDENTITY

 * ============================================================

 */



function rowToIdentity(row) {

  return {

    make:

      clean(

        row?.item_group

      ),



    model:

      clean(

        row?.type

      ),



    trim:

      clean(

        row?.class

      ),



    year:

      clean(

        row?.model

      ),

  };

}





/**

 * ============================================================

 * CAR IDENTITY KEY

 * ============================================================

 */



function identityKey(

  identity

) {

  return JSON.stringify([

    identity.make,

    identity.model,

    identity.trim,

    identity.year,

  ]);

}





/**

 * ============================================================

 * COMPLETE IDENTITY?

 * ============================================================

 */



function isCompleteIdentity(

  identity

) {

  return Boolean(

    identity?.make &&

    identity?.model &&

    identity?.trim &&

    identity?.year

  );

}





/**

 * ============================================================

 * FRAPPE WEBHOOK SIGNATURE VERIFICATION

 * ============================================================

 *

 * Frappe:

 *

 * HMAC-SHA256(

 *   webhook_secret,

 *   payload

 * )

 *

 * then Base64.

 *

 * بنجرب أكثر من representation للـJSON

 * لأن بعض نسخ Frappe تستخدم json.dumps(data).

 */



async function verifyFrappeWebhookSignature(

  rawBody,

  receivedSignature,

  secret

) {

  try {

    const normalizedSignature =

      normalizeSignature(

        receivedSignature

      );



    if (

      !normalizedSignature

    ) {

      return false;

    }



    const payloadCandidates =

      [];



    /**

     * Candidate 1:

     * Exact raw HTTP body.

     */

    payloadCandidates.push(

      rawBody

    );



    /**

     * Parse JSON.

     */

    let parsed;



    try {

      parsed =

        JSON.parse(

          rawBody

        );

    } catch {

      parsed =

        null;

    }



    if (

      parsed !== null

    ) {

      /**

       * Candidate 2:

       * Compact JS JSON

       */

      payloadCandidates.push(

        JSON.stringify(

          parsed

        )

      );



      /**

       * Candidate 3:

       * Python json.dumps style:

       *

       * {"event": "on_submit", "receipt": "..."}

       */

      payloadCandidates.push(

        pythonJsonDumps(

          parsed

        )

      );

    }



    const uniqueCandidates =

      unique(

        payloadCandidates

      );



    for (

      const payload

      of uniqueCandidates

    ) {

      const expectedSignature =

        await createHmacBase64(

          payload,

          secret

        );



      const matches =

        await secureStringEqual(

          expectedSignature,

          normalizedSignature

        );



      if (matches) {

        return true;

      }

    }



    return false;

  } catch (error) {

    console.error(

      "Webhook signature verification error:",

      error

    );



    return false;

  }

}





/**

 * ============================================================

 * CREATE HMAC SHA256 BASE64

 * ============================================================

 */



async function createHmacBase64(

  payload,

  secret

) {

  const encoder =

    new TextEncoder();



  const key =

    await crypto.subtle.importKey(

      "raw",



      encoder.encode(

        secret

      ),



      {

        name:

          "HMAC",



        hash:

          "SHA-256",

      },



      false,



      [

        "sign",

      ]

    );



  const signatureBuffer =

    await crypto.subtle.sign(

      "HMAC",



      key,



      encoder.encode(

        payload

      )

    );



  return arrayBufferToBase64(

    signatureBuffer

  );

}





/**

 * ============================================================

 * PYTHON json.dumps COMPATIBILITY

 * ============================================================

 *

 * Python default:

 *

 * json.dumps({

 *   "event": "on_submit",

 *   "receipt": "MAT..."

 * })

 *

 * =>

 *

 * {"event": "on_submit", "receipt": "MAT..."}

 */



function pythonJsonDumps(

  value

) {

  if (

    value === null

  ) {

    return "null";

  }



  if (

    typeof value ===

    "boolean"

  ) {

    return value

      ? "true"

      : "false";

  }



  if (

    typeof value ===

    "number"

  ) {

    return JSON.stringify(

      value

    );

  }



  if (

    typeof value ===

    "string"

  ) {

    return pythonJsonString(

      value

    );

  }



  if (

    Array.isArray(

      value

    )

  ) {

    return (

      "[" +

      value

        .map(

          (item) =>

            pythonJsonDumps(

              item

            )

        )

        .join(", ") +

      "]"

    );

  }



  if (

    typeof value ===

    "object"

  ) {

    const parts =

      Object.keys(value)

        .map(

          (key) =>

            `${pythonJsonString(key)}: ${pythonJsonDumps(value[key])}`

        );



    return (

      "{" +

      parts.join(", ") +

      "}"

    );

  }



  return "null";

}





/**

 * Python json.dumps default uses ensure_ascii=True.

 */



function pythonJsonString(

  value

) {

  const json =

    JSON.stringify(

      String(value)

    );



  return json.replace(

    /[\u007f-\uffff]/g,



    (char) => {

      const code =

        char

          .charCodeAt(0)

          .toString(16)

          .padStart(

            4,

            "0"

          );



      return `\\u${code}`;

    }

  );

}





/**

 * ============================================================

 * NORMALIZE SIGNATURE

 * ============================================================

 */



function normalizeSignature(

  value

) {

  let signature =

    clean(value);



  /**

   * لو header ظهر بصيغة:

   *

   * b'xxxx='

   *

   * أو

   *

   * b"xxxx="

   */

  if (

    signature.startsWith("b'") &&

    signature.endsWith("'")

  ) {

    signature =

      signature.slice(

        2,

        -1

      );

  }



  if (

    signature.startsWith('b"') &&

    signature.endsWith('"')

  ) {

    signature =

      signature.slice(

        2,

        -1

      );

  }



  return signature.trim();

}





/**

 * ============================================================

 * ARRAY BUFFER -> BASE64

 * ============================================================

 */



function arrayBufferToBase64(

  buffer

) {

  const bytes =

    new Uint8Array(

      buffer

    );



  let binary = "";



  for (

    let i = 0;

    i < bytes.length;

    i++

  ) {

    binary +=

      String.fromCharCode(

        bytes[i]

      );

  }



  return btoa(

    binary

  );

}





/**

 * ============================================================

 * SECURE STRING EQUALITY

 * ============================================================

 */



async function secureStringEqual(

  a,

  b

) {

  const encoder =

    new TextEncoder();



  const aHash =

    await crypto.subtle.digest(

      "SHA-256",



      encoder.encode(

        String(a)

      )

    );



  const bHash =

    await crypto.subtle.digest(

      "SHA-256",



      encoder.encode(

        String(b)

      )

    );



  const aBytes =

    new Uint8Array(

      aHash

    );



  const bBytes =

    new Uint8Array(

      bHash

    );



  if (

    aBytes.length !==

    bBytes.length

  ) {

    return false;

  }



  let result = 0;



  for (

    let i = 0;

    i < aBytes.length;

    i++

  ) {

    result |=

      aBytes[i] ^

      bBytes[i];

  }



  return result === 0;

}





/**

 * ============================================================

 * CONFIG VALIDATION

 * ============================================================

 */



function validateCoreConfig(

  env

) {

  const missing = [];



  const required = [

    "NEXT_API_KEY",

    "NEXT_API_SECRET",



    "WP_USERNAME",

    "WP_APP_PASSWORD",

  ];



  for (

    const key

    of required

  ) {

    if (!env[key]) {

      missing.push(

        key

      );

    }

  }



  if (

    missing.length

  ) {

    throw new Error(

      `Missing Worker configuration: ${missing.join(", ")}`

    );

  }

}





/**

 * ============================================================

 * READ JSON

 * ============================================================

 */



async function readJson(

  request

) {

  const text =

    await request.text();



  if (!text) {

    return {};

  }



  try {

    return JSON.parse(

      text

    );

  } catch {

    throw new Error(

      "Request body is not valid JSON."

    );

  }

}





/**

 * ============================================================

 * PARSE RESPONSE

 * ============================================================

 */



async function parseResponse(

  response

) {

  const text =

    await response.text();



  if (!text) {

    return null;

  }



  try {

    return JSON.parse(

      text

    );

  } catch {

    return text;

  }

}





/**

 * ============================================================

 * CONCURRENCY LIMIT

 * ============================================================

 */



async function mapLimit(

  items,

  limit,

  mapper

) {

  const results =

    new Array(

      items.length

    );



  let cursor = 0;



  async function worker() {

    while (true) {

      const index =

        cursor;



      cursor++;



      if (

        index >=

        items.length

      ) {

        return;

      }



      results[index] =

        await mapper(

          items[index],

          index

        );

    }

  }



  const workers =

    Array.from(

      {

        length:

          Math.min(

            limit,

            items.length

          ),

      },



      () =>

        worker()

    );



  await Promise.all(

    workers

  );



  return results;

}





/**

 * ============================================================

 * CLEAN

 * ============================================================

 */



function clean(value) {

  if (

    value === null ||

    value === undefined

  ) {

    return "";

  }



  return String(

    value

  ).trim();

}





/**

 * ============================================================

 * UNIQUE

 * ============================================================

 */



function unique(values) {

  return [

    ...new Set(values),

  ];

}





/**

 * ============================================================

 * STRIP TRAILING SLASH

 * ============================================================

 */



function stripTrailingSlash(

  value

) {

  return String(

    value

  ).replace(

    /\/+$/,

    ""

  );

}





/**

 * ============================================================

 * SERIALIZE ERROR

 * ============================================================

 */



function serializeError(

  error

) {

  return {

    name:

      error?.name ||

      "Error",



    message:

      error?.message ||

      String(error),



    stack:

      error?.stack ||

      null,

  };

}





/**

 * ============================================================

 * STRINGIFY ERROR VALUE

 * ============================================================

 */



function stringifyForError(

  value

) {

  if (

    typeof value ===

    "string"

  ) {

    return value;

  }



  try {

    return JSON.stringify(

      value

    );

  } catch {

    return String(

      value

    );

  }

}





/**
 * ============================================================
 * JSON RESPONSE
 * ============================================================
 */

function jsonResponse(

  data,

  status = 200

) {

  return new Response(

    JSON.stringify(

      data,

      null,

      2

    ),



    {

      status,



      headers: {

        "Content-Type":

          "application/json; charset=UTF-8",



        "Cache-Control":

          "no-store",

      },

    }

  );

}

/**
 * ============================================================
 * NEXT ERP -> MZJ OPERATIONS (ISOLATED STOCK SYNC)
 * ============================================================
 *
 * Deliberately separate from processPurchaseReceipt(), wordpressSyncCar(),
 * and the existing site sync payload. D1 is a persistent outbox; an optional
 * Cloudflare Queue gives 5/15-second retries and the scheduled event recovers
 * pending work even if a queue delivery has exhausted its retries.
 */

const OPERATIONS_STOCK_ENDPOINT = '/api/integrations/erpnext/purchase-receipt-stock';
const OPERATIONS_STOCK_MAX_BATCH = 1000;

function opsNowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function opsConfigReady(env, requireOutbox = true) {
  if (!env.NEXT_API_KEY || !env.NEXT_API_SECRET) {
    throw new Error('NEXT API credentials are missing.');
  }
  if (!env.MZJ_PLATFORM_URL || !env.MZJ_STOCK_SYNC_KEY) {
    throw new Error('MZJ_PLATFORM_URL / MZJ_STOCK_SYNC_KEY are required.');
  }
  const endpoint = new URL(OPERATIONS_STOCK_ENDPOINT, `${String(env.MZJ_PLATFORM_URL).replace(/\/+$/, '')}/`);
  if (endpoint.protocol !== 'https:') {
    throw new Error('MZJ_PLATFORM_URL must use HTTPS.');
  }
  if (requireOutbox && !env.MZJ_STOCK_DB) {
    throw new Error('MZJ_STOCK_DB D1 binding is required for durable retries.');
  }
}

function opsAdminAuthorized(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  return Boolean(env.WORKER_ADMIN_TOKEN && authorization === `Bearer ${env.WORKER_ADMIN_TOKEN}`);
}

function opsExtractVinList(value) {
  return String(value || '')
    .split(/[\r\n,]+/)
    .map((vin) => vin.trim())
    .filter(Boolean);
}

async function opsReceiptSerials(env, receiptName) {
  const receipt = await frappeGetDocument(env, 'Purchase Receipt', receiptName);
  if (!receipt || String(receipt.name || '') !== String(receiptName)) {
    throw new Error(`Purchase Receipt not found: ${receiptName}`);
  }
  // A canceled or draft receipt must never create a new Operations vehicle.
  if (Number(receipt.docstatus) !== 1) {
    return { canceledOrDraft: true, serials: [], receiptName };
  }
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  if (!items.length) throw new Error(`Receipt ${receiptName} contains no items.`);

  const all = [];
  for (const item of items) {
    let serials = opsExtractVinList(item.serial_no);
    if (!serials.length && item.serial_and_batch_bundle) {
      const bundle = await frappeGetDocument(env, 'Serial and Batch Bundle', item.serial_and_batch_bundle);
      serials = (Array.isArray(bundle?.entries) ? bundle.entries : [])
        .flatMap((entry) => opsExtractVinList(entry.serial_no));
    }
    const quantity = Number(item.stock_qty ?? item.qty ?? 0);
    if (!Number.isInteger(quantity) || quantity <= 0 || serials.length !== quantity) {
      throw new Error(
        `Receipt ${receiptName}, item ${item.item_code || '?'} has ${serials.length} VINs but quantity ${quantity}; refusing an incomplete import.`,
      );
    }
    all.push(...serials);
  }
  if (all.length > OPERATIONS_STOCK_MAX_BATCH) {
    throw new Error(`Receipt contains more than ${OPERATIONS_STOCK_MAX_BATCH} VINs; manual review required.`);
  }
  if (new Set(all.map((vin) => vin.toUpperCase())).size !== all.length) {
    throw new Error(`Receipt ${receiptName} contains duplicate VINs.`);
  }
  return { canceledOrDraft: false, serials: all, receiptName };
}

async function opsPrepareReceiptPayload(env, receiptName) {
  const result = await opsReceiptSerials(env, receiptName);
  if (result.canceledOrDraft) {
    return { receipt: receiptName, event: 'on_submit', ignored: true, reason: 'Receipt is not submitted' };
  }
  const vehicles = await mapLimit(result.serials, CONCURRENCY, async (serial) => {
    // The Serial No currently contains the *current* warehouse/status/notes,
    // unlike receipt stock rows and purchase_document_no (which may change).
    const doc = await frappeGetDocument(env, 'Serial No', serial);
    if (!doc) throw new Error(`Missing Serial No: ${serial}`);
    const found = clean(doc.serial_no || doc.name);
    if (found !== serial) {
      throw new Error(`VIN identity mismatch: receipt=${serial}, Serial No=${found}`);
    }
    return {
      serial_no: serial,
      name: clean(doc.name),
      type: clean(doc.type),
      class: clean(doc.class),
      agent: clean(doc.agent),
      model: clean(doc.model),
      custom_color: clean(doc.custom_color),
      custom_external_color: clean(doc.custom_external_color),
      warehouse: clean(doc.warehouse),
      car_status: clean(doc.car_status),
      detail: clean(doc.detail),
      status: clean(doc.status),
    };
  });
  return { receipt: receiptName, event: 'on_submit', vehicles };
}

async function opsSendToPlatform(env, payload, dryRun = false) {
  opsConfigReady(env, false);
  const url = new URL(OPERATIONS_STOCK_ENDPOINT, `${String(env.MZJ_PLATFORM_URL).replace(/\/+$/, '')}/`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'X-MZJ-Stock-Key': String(env.MZJ_STOCK_SYNC_KEY),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ...payload, dryRun }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const data = await parseResponse(response);
  if (!response.ok || data?.ok !== true) {
    throw new Error(`Operations API rejected receipt ${payload.receipt} (${response.status}): ${stringifyForError(data)}`);
  }
  if (!dryRun && !payload.ignored) {
    const accepted = Number(data.inserted || 0) + Number(data.skipped || 0);
    if (Number(data.total) !== payload.vehicles.length || accepted !== payload.vehicles.length) {
      throw new Error(`Operations API acknowledged ${accepted}/${payload.vehicles.length} vehicles; retrying.`);
    }
  }
  return data;
}

function opsD1(env) {
  if (!env.MZJ_STOCK_DB) throw new Error('MZJ_STOCK_DB D1 binding is missing.');
  return env.MZJ_STOCK_DB;
}

async function opsEnqueueReceipt(env, receipt, event = 'on_submit') {
  opsConfigReady(env, true);
  if (event !== 'on_submit') return { ok: true, ignored: true, event };
  const db = opsD1(env);
  const now = opsNowSeconds();
  await db.prepare(`
    insert into mzj_operations_stock_jobs
      (receipt, event, state, attempts, next_attempt_at, locked_until, created_at, updated_at)
    values (?, ?, 'pending', 0, ?, 0, ?, ?)
    on conflict(receipt) do update set
      updated_at=excluded.updated_at
    where mzj_operations_stock_jobs.state != 'delivered'
  `).bind(receipt, event, now, now, now).run();

  // The outbox commit happens before queue delivery. Cron is the fallback.
  if (env.MZJ_STOCK_QUEUE && typeof env.MZJ_STOCK_QUEUE.send === 'function') {
    try {
      await env.MZJ_STOCK_QUEUE.send({ receipt });
      return { ok: true, receipt, queued: true, persistent: true };
    } catch (error) {
      console.error('MZJ stock Queue send failed; D1 will recover', { receipt, error: serializeError(error) });
    }
  }
  // Without Queues, attempt once immediately. Scheduled retry catches failures.
  const attempt = await opsProcessPendingReceipt(env, receipt);
  return { ok: true, receipt, queued: false, persistent: true, attempt };
}

function opsRetryDelaySeconds(attemptNumber) {
  if (attemptNumber <= 1) return 5;
  if (attemptNumber === 2) return 15;
  if (attemptNumber === 3) return 60;
  if (attemptNumber === 4) return 120;
  return Math.min(3600, 300 * 2 ** Math.min(attemptNumber - 5, 4));
}

async function opsProcessPendingReceipt(env, receipt) {
  const db = opsD1(env);
  const now = opsNowSeconds();
  const job = await db.prepare(`
    update mzj_operations_stock_jobs
       set locked_until = ?, updated_at = ?
     where receipt = ? and state = 'pending'
       and next_attempt_at <= ? and locked_until <= ?
    returning receipt, event, attempts
  `).bind(now + 120, now, receipt, now, now).first();
  if (!job) {
    const row = await db.prepare(`
      select state, next_attempt_at, locked_until
        from mzj_operations_stock_jobs where receipt = ?
    `).bind(receipt).first();
    return {
      ok: true,
      claimed: false,
      state: row?.state || 'missing',
      retryAfter: Math.max(1, Number(row?.next_attempt_at || now + 60) - now, Number(row?.locked_until || 0) - now),
    };
  }
  try {
    const payload = await opsPrepareReceiptPayload(env, receipt);
    const platform = payload.ignored
      ? { ok: true, ignored: true, reason: payload.reason }
      : await opsSendToPlatform(env, payload);
    await db.prepare(`
      update mzj_operations_stock_jobs
         set state = 'delivered', attempts = attempts + 1,
             locked_until = 0, delivered_at = ?, updated_at = ?, last_error = null
       where receipt = ?
    `).bind(opsNowSeconds(), opsNowSeconds(), receipt).run();
    console.log('MZJ Operations stock receipt synchronized', { receipt, ignored: Boolean(platform.ignored) });
    return { ok: true, claimed: true, receipt, delivered: true };
  } catch (error) {
    const attemptNumber = Number(job.attempts || 0) + 1;
    const delay = opsRetryDelaySeconds(attemptNumber);
    const msg = clean(error?.message || String(error)).slice(0, 1500);
    await db.prepare(`
      update mzj_operations_stock_jobs
         set state='pending', attempts=?, locked_until=0,
             next_attempt_at=?, updated_at=?, last_error=?
       where receipt=?
    `).bind(attemptNumber, opsNowSeconds() + delay, opsNowSeconds(), msg, receipt).run();
    console.error('MZJ Operations sync pending retry', { receipt, attemptNumber, retryAfterSeconds: delay, error: msg });
    return { ok: false, claimed: true, receipt, retryAfter: delay, attempts: attemptNumber };
  }
}

async function opsDrainDueReceipts(env, limit = 10) {
  if (!env.MZJ_STOCK_DB) return;
  const now = opsNowSeconds();
  const rows = await opsD1(env).prepare(`
    select receipt from mzj_operations_stock_jobs
    where state='pending' and next_attempt_at <= ? and locked_until <= ?
    order by next_attempt_at asc limit ?
  `).bind(now, now, Math.min(30, Math.max(1, limit))).all();
  const results = [];
  for (const row of rows.results || []) {
    results.push(await opsProcessPendingReceipt(env, row.receipt));
  }
  return results;
}

async function opsManualRequest(request, env, ctx, pathname) {
  if (!opsAdminAuthorized(request, env)) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  const body = await readJson(request);
  const receipt = clean(body.receipt || body.name);
  if (!receipt) return jsonResponse({ ok: false, error: 'Missing receipt' }, 400);
  const event = clean(body.event || 'on_submit');
  if (!['on_submit', 'on_cancel'].includes(event)) {
    return jsonResponse({ ok: false, error: 'Invalid event' }, 400);
  }
  if (pathname === '/operations/preview' || body.dryRun === true) {
    const payload = await opsPrepareReceiptPayload(env, receipt);
    const platform = body.checkPlatform === true && !payload.ignored
      ? await opsSendToPlatform(env, payload, true) : null;
    return jsonResponse({ ok: true, dryRun: true, payload, platform, writes: 0 });
  }
  if (event === 'on_cancel') return jsonResponse({ ok: true, ignored: true, reason: 'No automatic deletion on cancellation' });
  const queued = await opsEnqueueReceipt(env, receipt, event);
  return jsonResponse({ ok: true, ...queued }, 202);
}
