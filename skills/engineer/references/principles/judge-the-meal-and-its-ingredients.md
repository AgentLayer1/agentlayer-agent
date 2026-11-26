# Judge the meal and its ingredients

**Apply when:** reviewing a change, your own or someone else's, before calling it ready.

A review judges two things, and neither stands in for the other: what the change does when it runs (the meal), and the code it is made of (the ingredients).

**The meal.** Prove the outcome by running it. Write probes from the stated intent (the description, the issue's acceptance criteria, a walkthrough) and the public interface, without reading the implementation, so a probe tests what was asked rather than what was built. A probe written from the diff confirms the diff: the cook tasting their own food. Run each probe on the head, and on the base too when a claim says "fixes X" (it should fail there) or "no behavior change" (both runs must match).

**The ingredients.** Read the code against the architecture, the repo's conventions, and the other principles. A change whose probes all pass can still be made of bad ingredients: a feature threaded through shared flows, a second mechanism beside an existing one, a name that misleads, a guard in the wrong layer. They are what make the next change slow, risky or wrong, and no run shows them.

**The check:** does every claim have a run behind it, and every changed file a reading? A passing probe never excuses a structural finding, and a clean reading never excuses a failing probe. A probe that could not run is listed as not checked, never counted as a pass.

**The fix:** a failed meal is reported as the failing call and its real output. A bad ingredient is reported with the principle or repo rule it breaks. A probe that pins real behavior is offered to the author as a test, in the repo's own test style and only where its test policy wants one; the rest is evidence, and is deleted with the review.
