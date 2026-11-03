package tcc.harness;

import java.util.List;

/**
 * The scripted interaction, one measured step at a time. The order is chosen so
 * every pass covers each cost class the scheduler models:
 *
 * <ol>
 *   <li>{@code sort-price}: numeric sort of all rows (Float64 compare)
 *   <li>{@code sort-name}: dictionary-code sort of all rows (integer compare)
 *   <li>{@code search}: text filter on name; cost depends on the match mode
 *       (contains = scan, token/prefix = inverted index), plus the name sort
 *   <li>{@code category}: facet filter on top (10 distinct values), plus the sort
 * </ol>
 *
 * Each step is a real user input dispatched by Playwright, and each ends when
 * the page has painted the result of the query it started.
 */
public enum Step {
  SORT_PRICE("sort-price", false),
  SORT_NAME("sort-name", false),
  SEARCH("search", true),
  CATEGORY("category", true);

  public final String id;
  /** Needs the shop chrome (header, sidebar): not available under cond=empty. */
  public final boolean needsChrome;

  Step(String id, boolean needsChrome) {
    this.id = id;
    this.needsChrome = needsChrome;
  }

  public static List<Step> forCond(String cond) {
    boolean chrome = !cond.equals("empty");
    return List.of(values()).stream().filter(s -> chrome || !s.needsChrome).toList();
  }
}
